import { createHash, timingSafeEqual, createHmac } from "node:crypto";
import { apiKeys, type Database } from "@monark/db";
import { and, eq, isNull, sql } from "drizzle-orm";

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
 * Browser-policy keys permit bearer-only calls because client code cannot hold
 * a secret. Server-policy keys require HMAC on every request.
 */

export interface AuthenticatedKey {
  id: string;
  orgId: string;
  projectId: string | null;
  scopes: string[];
  signingSecretEncrypted: string;
  keyPolicy: "browser" | "server";
  signatureRequired: boolean;
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

  const keyPolicy = row.keyPolicy === "server" ? "server" : "browser";
  const configuredRateLimit = Number(row.rateLimitPerMinute);

  return {
    ok: true,
    key: {
      id: row.id,
      orgId: row.orgId,
      projectId: row.projectId,
      scopes: row.scopes,
      signingSecretEncrypted: row.signingSecretEncrypted,
      keyPolicy,
      // Fail closed if a malformed legacy row says "server" but has not had
      // its derived boolean repaired yet.
      signatureRequired: keyPolicy === "server" || row.signatureRequired,
      rateLimitPerMinute:
        Number.isInteger(configuredRateLimit) &&
        configuredRateLimit >= 1 &&
        configuredRateLimit <= 10_000
          ? configuredRateLimit
          : 120,
    },
  };
}

export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function isRequiredSignatureMissing(
  key: Pick<AuthenticatedKey, "signatureRequired">,
  signatureHeader: string | undefined,
): boolean {
  return key.signatureRequired && !signatureHeader;
}

/**
 * Verify `X-Monark-Signature: t=<unix>,v1=<hex>`.
 *
 * The timestamp is inside the signed payload, so an attacker cannot replay an
 * old request by simply changing the header — and the tolerance window bounds
 * how long a captured request stays useful.
 */
export function verifySignature(params: {
  header: string | undefined;
  rawBody: string | Uint8Array;
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
 * Consume one request from a database-backed fixed-minute bucket.
 *
 * The UPSERT is one Postgres statement, so every serverless replica contends
 * on the same row and the `WHERE request_count < limit` check is atomic. Old
 * rows for this key are pruned in the same statement to keep the table bounded.
 */
export async function consumeRateLimit(
  db: Database,
  keyId: string,
  orgId: string,
  limitPerMinute: number,
): Promise<boolean> {
  const limit = Math.max(1, Math.min(Math.trunc(limitPerMinute) || 1, 10_000));
  const result = await db.execute(sql`
    WITH bucket_clock AS (
      SELECT date_trunc('minute', now()) AS window_start
    ), pruned AS (
      DELETE FROM api_rate_limit_buckets
      USING bucket_clock
      WHERE api_rate_limit_buckets.api_key_id = ${keyId}
        AND api_rate_limit_buckets.window_start < bucket_clock.window_start - interval '2 hours'
      RETURNING api_rate_limit_buckets.api_key_id
    ), consumed AS (
      INSERT INTO api_rate_limit_buckets (
        org_id, api_key_id, window_start, request_count
      )
      SELECT authenticated_key.org_id, authenticated_key.id, bucket_clock.window_start, 1
      FROM bucket_clock
      JOIN api_keys authenticated_key
        ON authenticated_key.id = ${keyId}
       AND authenticated_key.org_id = ${orgId}
      ON CONFLICT (api_key_id, window_start) DO UPDATE
      SET request_count = api_rate_limit_buckets.request_count + 1
      WHERE api_rate_limit_buckets.request_count < ${limit}
      RETURNING request_count
    )
    SELECT request_count AS "requestCount" FROM consumed
  `);

  return result.rows.length === 1;
}
