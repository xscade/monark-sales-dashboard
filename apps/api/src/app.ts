import { getDb, idempotencyKeys } from "@monark/db";
import { decryptCredentials, ingestLead } from "@monark/services";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { authenticate, checkRateLimit, verifySignature } from "./auth";
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
  if (!checkRateLimit(key.id, key.rateLimitPerMinute)) {
    return c.json({ error: "Rate limit exceeded" }, 429);
  }

  // Read the raw body once — HMAC must be computed over the exact bytes sent,
  // not over a re-serialised object, which would reorder keys and never match.
  const rawBody = await c.req.text();

  const signatureHeader = c.req.header("X-Monark-Signature");
  if (signatureHeader) {
    let secret: string;
    try {
      secret = decryptCredentials(key.signingSecretEncrypted).secret;
    } catch {
      return c.json({ error: "Signing secret unavailable for this key" }, 500);
    }
    const verified = verifySignature({ header: signatureHeader, rawBody, secret });
    if (!verified.ok) {
      return c.json({ error: verified.error }, 401);
    }
  }

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

  // -------------------------------------------------------------------
  // Idempotency
  //
  // A form that retries on a flaky mobile connection must not create five
  // leads. We replay the original response byte-for-byte rather than
  // re-inserting, and reject a same-key/different-body replay loudly because
  // that is a caller bug that would otherwise silently drop data.
  // -------------------------------------------------------------------
  const idempotencyKey = c.req.header("Idempotency-Key");
  const requestHash = createHash("sha256").update(rawBody).digest("hex");

  if (idempotencyKey) {
    const [existing] = await db
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.orgId, key.orgId),
          eq(idempotencyKeys.key, idempotencyKey),
          eq(idempotencyKeys.endpoint, "POST /v1/leads"),
        ),
      )
      .limit(1);

    if (existing) {
      if (existing.requestHash !== requestHash) {
        return c.json(
          { error: "Idempotency-Key was reused with a different request body" },
          409,
        );
      }
      return c.json(existing.responseBody as object, Number(existing.responseStatus) as 200);
    }
  }

  const forwardedFor = c.req.header("X-Forwarded-For");
  const ipAddress = forwardedFor?.split(",")[0]?.trim() ?? null;

  try {
    const result = await db.transaction((tx) =>
      ingestLead(tx, {
        orgId: key.orgId,
        // A project-scoped key pins the project so an agency cannot write into
        // the wrong development, deliberately or by accident.
        projectId: key.projectId ?? input.project_id ?? null,
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
      }),
    );

    const responseBody = {
      lead_id: result.leadId,
      lead_reference: result.leadReference,
      person_id: result.personId,
      status: result.isNewLead ? "created" : "attached_to_existing",
      is_duplicate: !result.isNewLead,
      /** Surfaced so a caller can see when their form is being gamed. */
      spam_score: result.spamScore,
      /**
       * When Google stops attributing offline conversions for this click.
       * Exposed deliberately: it is the clock the whole feedback loop runs on.
       */
      attribution_expires_at: result.attributionExpiresAt?.toISOString() ?? null,
    };

    if (idempotencyKey) {
      await db
        .insert(idempotencyKeys)
        .values({
          orgId: key.orgId,
          key: idempotencyKey,
          endpoint: "POST /v1/leads",
          requestHash,
          responseStatus: "200",
          responseBody,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .onConflictDoNothing();
    }

    return c.json(responseBody, 200);
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
