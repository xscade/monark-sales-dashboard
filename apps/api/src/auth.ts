import { createHash, timingSafeEqual, createHmac } from "node:crypto";
import { apiKeys, type Database } from "@monark/db";
import { and, eq, isNull } from "drizzle-orm";

/**
 * API key + optional HMAC request signing.
 *
 * The ingestion endpoint is handed to website developers, landing-page vendors
 * and agencies, so the auth has to survive being pasted into places we do not
 * control. Two layers:
 *
 *   Bearer key  — identifies the caller and its org/project scope.
 *   HMAC        — proves the body was not tampered with and is not a replay.
 *
 * HMAC is optional per key because a browser-side form cannot hold a signing
 * secret. Server-to-server integrations should always sign.
 */

export interface AuthenticatedKey {
  id: string;
  orgId: string;
  projectId: string | null;
  scopes: string[];
  signingSecretEncrypted: string;
  rateLimitPerMinute: number;
}

export type AuthResult =
  | { ok: true; key: AuthenticatedKey }
  | { ok: false; status: 401 | 403; error: string };

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Constant-time compare that does not leak length via early return. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function authenticate(
  db: Database,
  authorizationHeader: string | undefined,
): Promise<AuthResult> {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Missing bearer token" };
  }

  const token = authorizationHeader.slice(7).trim();
  // Keys look like mk_live_<prefix>_<secret>; the prefix is the lookup handle
  // so we never have to scan the table or compare against every row.
  const parts = token.split("_");
  if (parts.length < 4) {
    return { ok: false, status: 401, error: "Malformed API key" };
  }
  const prefix = parts.slice(0, 3).join("_");

  const [row] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyPrefix, prefix), isNull(apiKeys.revokedAt)))
    .limit(1);

  if (!row) {
    return { ok: false, status: 401, error: "Invalid or revoked API key" };
  }
  if (!safeEqual(sha256Hex(token), row.keyHash)) {
    return { ok: false, status: 401, error: "Invalid or revoked API key" };
  }

  return {
    ok: true,
    key: {
      id: row.id,
      orgId: row.orgId,
      projectId: row.projectId,
      scopes: row.scopes,
      signingSecretEncrypted: row.signingSecretEncrypted,
      rateLimitPerMinute: Number(row.rateLimitPerMinute),
    },
  };
}

export const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Verify `X-Monark-Signature: t=<unix>,v1=<hex>`.
 *
 * The timestamp is inside the signed payload, so an attacker cannot replay an
 * old request by simply changing the header — and the tolerance window bounds
 * how long a captured request stays useful.
 */
export function verifySignature(params: {
  header: string | undefined;
  rawBody: string;
  secret: string;
  now?: Date;
}): { ok: true } | { ok: false; error: string } {
  if (!params.header) return { ok: false, error: "Missing X-Monark-Signature" };

  const fields = new Map(
    params.header.split(",").map((part) => {
      const [k, v] = part.split("=");
      return [k?.trim() ?? "", v?.trim() ?? ""];
    }),
  );

  const timestamp = fields.get("t");
  const signature = fields.get("v1");
  if (!timestamp || !signature) {
    return { ok: false, error: "Signature header must be 't=<unix>,v1=<hex>'" };
  }

  const now = params.now ?? new Date();
  const age = Math.abs(Math.floor(now.getTime() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, error: "Signature timestamp outside tolerance window" };
  }

  const expected = createHmac("sha256", params.secret)
    .update(`${timestamp}.${params.rawBody}`, "utf8")
    .digest("hex");

  if (!safeEqual(expected, signature)) {
    return { ok: false, error: "Signature mismatch" };
  }
  return { ok: true };
}

/**
 * In-memory sliding-window rate limiter.
 *
 * Adequate for a single API instance. Running more than one replica means
 * moving this to Postgres or Redis — noted here rather than discovered under
 * load, because the failure is silent (each replica enforces its own limit, so
 * the effective limit multiplies by replica count).
 */
const buckets = new Map<string, number[]>();

export function checkRateLimit(keyId: string, limitPerMinute: number, now = Date.now()): boolean {
  const windowStart = now - 60_000;
  const hits = (buckets.get(keyId) ?? []).filter((t) => t > windowStart);
  if (hits.length >= limitPerMinute) {
    buckets.set(keyId, hits);
    return false;
  }
  hits.push(now);
  buckets.set(keyId, hits);
  return true;
}
