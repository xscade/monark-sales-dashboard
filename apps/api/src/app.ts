import { apiKeys, getDb, idempotencyKeys } from "@monark/db";
import { decryptCredentials, ingestLead } from "@monark/services";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  authenticate,
  consumeRateLimit,
  isRequiredSignatureMissing,
  verifySignature,
} from "./auth";
import { readBoundedRequestBody, RequestBodyError } from "./body";
import { runOutboxDrain } from "./cron";
import { LeadIngestSchema } from "./schemas";

const app = new Hono();

/**
 * CORS is deliberately permissive on the ingestion path only.
 *
 * Monark's own site, landing pages built by agencies, and campaign microsites
 * on throwaway domains all need to POST here. The API key is the access
 * control; an origin allowlist would be security theatre that mostly generates
 * support tickets when marketing spins up a new domain on a Friday.
 */
app.use("/v1/*", cors({ origin: "*", allowHeaders: ["Content-Type", "Authorization", "X-Monark-Signature", "Idempotency-Key"] }));

app.get("/health", (c) => c.json({ ok: true, service: "monark-api" }));

/**
 * Cron endpoint, mounted for LOCAL development only.
 *
 * On Vercel, `vercel.json` rewrites /api/cron/* straight to the dedicated
 * function, so this route is never reached there — it exists so the drain can
 * be exercised with a real bearer token before deploying. Same handler, same
 * auth, so a local pass means the deployed one will pass too.
 */
app.all("/api/cron/outbox", (c) => runOutboxDrain(c.req.raw));

/** Unexpected errors must still return JSON — a caller parsing our response
 *  should never suddenly receive Hono's HTML error page. */
app.onError((err, c) => {
  console.error(
    JSON.stringify({
      level: "error",
      message: "Unhandled error",
      path: c.req.path,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  return c.json({ error: "Internal server error" }, 500);
});

/**
 * POST /v1/leads — the universal ingestion endpoint.
 *
 * One door for every source: website forms, landing pages, Meta Lead Ads,
 * WhatsApp, portals, agencies. Everything downstream — deduplication,
 * attribution capture, consent, conversion emission — happens behind it, so
 * adding a new source never means reimplementing any of that.
 */
app.post("/v1/leads", async (c) => {
  // Reject malformed credentials BEFORE touching the database. Otherwise every
  // unauthenticated request — including a trivial flood of them — costs a
  // connection, and a database problem surfaces as 500 instead of 401.
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing bearer token" }, 401);
  }

  const db = getDb();

  const auth = await authenticate(db, authHeader);
  if (!auth.ok) {
    return c.json({ error: auth.error }, auth.status);
  }
  const { key } = auth;

  if (!key.scopes.includes("leads:write")) {
    return c.json({ error: "API key lacks the leads:write scope" }, 403);
  }
  if (!(await consumeRateLimit(db, key.id, key.orgId, key.rateLimitPerMinute))) {
    return c.json({ error: "Rate limit exceeded" }, 429);
  }

  const signatureHeader = c.req.header("X-Monark-Signature");
  if (isRequiredSignatureMissing(key, signatureHeader)) {
    return c.json({ error: "Missing X-Monark-Signature for server API key" }, 401);
  }

  // Read the raw body once — HMAC must be computed over the exact bytes sent,
  // not over a re-serialised object, which would reorder keys and never match.
  // The streaming reader stops at 64 KiB instead of allowing Request.text() to
  // buffer an attacker-controlled payload without bound.
  let rawBody: string;
  let rawBodyBytes: Uint8Array;
  try {
    const body = await readBoundedRequestBody(c.req.raw);
    rawBody = body.text;
    rawBodyBytes = body.bytes;
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return c.json({ error: error.message }, error.status);
    }
    throw error;
  }

  if (signatureHeader) {
    let secret: string;
    try {
      secret = decryptCredentials(key.signingSecretEncrypted).secret;
    } catch {
      return c.json({ error: "Signing secret unavailable for this key" }, 500);
    }
    const verified = verifySignature({ header: signatureHeader, rawBody: rawBodyBytes, secret });
    if (!verified.ok) {
      return c.json({ error: verified.error }, 401);
    }
  }

  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Request body is not valid JSON" }, 400);
  }

  const parsed = LeadIngestSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return c.json(
      {
        error: "Validation failed",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      },
      422,
    );
  }
  const input = parsed.data;
  if (key.projectId && input.project_id && input.project_id !== key.projectId) {
    return c.json({ error: "API key is scoped to a different project" }, 403);
  }
  const effectiveProjectId = key.projectId ?? input.project_id ?? null;
  const ledgerEndpoint = `POST /v1/leads:key:${key.id}:project:${effectiveProjectId ?? "org"}`;

  // -------------------------------------------------------------------
  // Idempotency
  //
  // A form that retries on a flaky mobile connection must not create five
  // leads. We replay the original response byte-for-byte rather than
  // re-inserting, and reject a same-key/different-body replay loudly because
  // that is a caller bug that would otherwise silently drop data.
  // -------------------------------------------------------------------
  const idempotencyKey = c.req.header("Idempotency-Key");
  const requestHash = createHash("sha256").update(rawBodyBytes).digest("hex");

  const forwardedFor = c.req.header("X-Forwarded-For");
  const ipAddress = forwardedFor?.split(",")[0]?.trim() ?? null;

  try {
    const outcome = await db.transaction(async (tx) => {
      if (effectiveProjectId) {
        const project = await tx.execute(sql`
          SELECT id FROM projects
          WHERE id = ${effectiveProjectId}
            AND org_id = ${key.orgId}
            AND is_active = true
          FOR SHARE
        `);
        if (!project.rows[0]) return { kind: "invalid_project" as const };
      }
      if (idempotencyKey) {
        // Serialise requests for the same org/endpoint/key before checking the
        // ledger. This closes the race where two retries could both pass the
        // old check-then-insert sequence and create duplicate touchpoints.
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`${key.orgId}:${ledgerEndpoint}:${idempotencyKey}`}, 0)
          )
        `);
        await tx.execute(sql`
          DELETE FROM idempotency_keys
          WHERE org_id = ${key.orgId}
            AND key = ${idempotencyKey}
            AND endpoint = ${ledgerEndpoint}
            AND expires_at <= now()
        `);
        const [existing] = await tx
          .select()
          .from(idempotencyKeys)
          .where(
            and(
              eq(idempotencyKeys.orgId, key.orgId),
              eq(idempotencyKeys.key, idempotencyKey),
              eq(idempotencyKeys.endpoint, ledgerEndpoint),
            ),
          )
          .limit(1);
        if (existing) {
          if (existing.requestHash !== requestHash) {
            return { kind: "conflict" as const };
          }
          return {
            kind: "replay" as const,
            responseBody: existing.responseBody as Record<string, unknown>,
            responseStatus: Number(existing.responseStatus),
          };
        }
      }

      const result = await ingestLead(tx, {
        orgId: key.orgId,
        // A project-scoped key pins the project so an agency cannot write into
        // the wrong development, deliberately or by accident.
        projectId: effectiveProjectId,
        name: input.name,
        phone: input.phone,
        email: input.email,
        city: input.city,
        state: input.state,
        postalCode: input.postal_code,
        source: input.source,
        sourceDetail: input.source_detail,
        utm: {
          source: input.utm_source,
          medium: input.utm_medium,
          campaign: input.utm_campaign,
          content: input.utm_content,
          term: input.utm_term,
          id: input.utm_id,
        },
        adHierarchy: {
          platform: input.ad_platform,
          campaignId: input.campaign_id,
          campaignName: input.campaign_name,
          adsetId: input.adset_id,
          adsetName: input.adset_name,
          adId: input.ad_id,
          adName: input.ad_name,
          creativeId: input.creative_id,
          creativeName: input.creative_name,
          keyword: input.keyword,
          matchType: input.match_type,
          placement: input.placement,
        },
        clickIds: {
          gclid: input.gclid,
          gbraid: input.gbraid,
          wbraid: input.wbraid,
          fbclid: input.fbclid,
          fbp: input.fbp,
          fbc: input.fbc,
          ctwaClid: input.ctwa_clid,
          metaLeadId: input.meta_lead_id,
          msclkid: input.msclkid,
          liFatId: input.li_fat_id,
        },
        browserEventId: input.event_id,
        landingPage: input.landing_page,
        referrer: input.referrer,
        userAgent: c.req.header("User-Agent") ?? null,
        ipAddress,
        clickedAt: input.clicked_at ? new Date(input.clicked_at) : null,
        occurredAt: input.occurred_at ? new Date(input.occurred_at) : null,
        consent: input.consent
          ? {
              marketing: input.consent.marketing,
              adUserData: input.consent.ad_user_data,
              adPersonalization: input.consent.ad_personalization,
              policyVersion: input.consent.policy_version,
              collectedVia: input.consent.collected_via,
            }
          : undefined,
        externalId: input.external_id,
        notes: input.notes,
        timeOnPageSeconds: input.time_on_page_seconds,
        rawPayload: parsedJson,
      });

      const responseBody = {
        lead_id: result.leadId,
        lead_reference: result.leadReference,
        person_id: result.personId,
        status: result.isNewLead ? "created" : "attached_to_existing",
        is_duplicate: !result.isNewLead,
        spam_score: result.spamScore,
        attribution_expires_at: result.attributionExpiresAt?.toISOString() ?? null,
      };

      if (idempotencyKey) {
        await tx.insert(idempotencyKeys).values({
          orgId: key.orgId,
          key: idempotencyKey,
          endpoint: ledgerEndpoint,
          requestHash,
          responseStatus: "200",
          responseBody,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });
      }

      return { kind: "created" as const, responseBody, responseStatus: 200 };
    });

    if (outcome.kind === "conflict") {
      return c.json({ error: "Idempotency-Key was reused with a different request body" }, 409);
    }
    if (outcome.kind === "invalid_project") {
      return c.json({ error: "Project is not active in this organisation" }, key.projectId ? 403 : 422);
    }
    return c.json(outcome.responseBody, outcome.responseStatus as 200);
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "Lead ingestion failed",
        error: err instanceof Error ? err.message : String(err),
        // Never log the body — it is customer PII.
        orgId: key.orgId,
      }),
    );
    return c.json({ error: "Internal error while creating lead" }, 500);
  }
});

export default app;
export { app };
