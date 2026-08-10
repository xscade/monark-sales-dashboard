import { createHash } from "node:crypto";
import { normalizeEmail, normalizeNamePart } from "./email";
import { normalizePhone } from "./phone";

/**
 * PII hashing for ad-platform matching.
 *
 * Everything here exists because Meta and Google each compute SHA-256 over
 * *their own* normalization of the customer's data, then compare digests. If
 * our normalization differs from theirs by a single character, the digests
 * differ completely and the match silently fails. There is no partial credit
 * and no error message — you just get a low match rate and no explanation.
 *
 * So: this module is the ONLY place PII is hashed, it is heavily tested, and
 * every rule below is deliberate rather than incidental.
 *
 * ── The one genuinely dangerous divergence ───────────────────────────────
 * The two platforms disagree about phone number format:
 *
 *   Meta   — digits only, country code included, no '+', no leading zeros.
 *            hash("919876543210")
 *   Google — E.164, i.e. WITH the leading '+'.
 *            hash("+919876543210")
 *
 * Google's own Data Manager reference has at times described this as "remove
 * non-digit characters", which contradicts the E.164 requirement documented
 * for enhanced conversions and Customer Match. We default to E.164-with-plus
 * because that is the long-standing, more widely corroborated rule — but the
 * format is a configurable knob per destination precisely because this is the
 * single most likely cause of an unexplained low match rate.
 *
 * If Google match rate looks wrong, flip `phoneFormat` on the destination and
 * compare over a week. Do not guess in production: use the hash preview tool
 * (`pnpm --filter @monark/core hash:preview`) to inspect exact inputs first.
 */

export type PhoneHashFormat = "e164_with_plus" | "digits_only";

export interface HashOptions {
  phoneFormat: PhoneHashFormat;
  encoding: "hex" | "base64";
}

export const META_HASH_OPTIONS: HashOptions = {
  phoneFormat: "digits_only",
  encoding: "hex",
};

export const GOOGLE_HASH_OPTIONS: HashOptions = {
  phoneFormat: "e164_with_plus",
  encoding: "hex",
};

function sha256(value: string, encoding: "hex" | "base64" = "hex"): string {
  return createHash("sha256").update(value, "utf8").digest(encoding);
}

/**
 * Hash an already-normalized value.
 *
 * Deliberately named to make call sites read as an assertion: if you are
 * reaching for this, the value must already be in its canonical form.
 */
export function hashNormalized(value: string, encoding: "hex" | "base64" = "hex"): string {
  return sha256(value, encoding);
}

export function hashEmail(
  email: string | null | undefined,
  opts: HashOptions = META_HASH_OPTIONS,
): string | null {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  // NOTE: `forHashing`, not `canonical`. Our dedup-oriented canonicalisation
  // (dot stripping, +tag removal) would not match what the platform hashed.
  return sha256(normalized.forHashing, opts.encoding);
}

export function hashPhone(
  phone: string | null | undefined,
  opts: HashOptions = META_HASH_OPTIONS,
): string | null {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const value = opts.phoneFormat === "e164_with_plus" ? normalized.e164 : normalized.digits;
  return sha256(value, opts.encoding);
}

export function hashName(
  name: string | null | undefined,
  opts: HashOptions = META_HASH_OPTIONS,
): string | null {
  const normalized = normalizeNamePart(name);
  if (!normalized) return null;
  return sha256(normalized, opts.encoding);
}

/** City: lowercase, letters only, no spaces or punctuation.
 *  "Visakhapatnam" → "visakhapatnam"; "New Delhi" → "newdelhi". */
export function hashCity(
  city: string | null | undefined,
  opts: HashOptions = META_HASH_OPTIONS,
): string | null {
  const normalized = normalizeNamePart(city)?.replace(/\s/g, "");
  if (!normalized) return null;
  return sha256(normalized, opts.encoding);
}

/** State. Meta expects the 2-letter code for US/CA; for India there is no such
 *  code, so the full lowercase name is the accepted form. */
export function hashState(
  state: string | null | undefined,
  opts: HashOptions = META_HASH_OPTIONS,
): string | null {
  const normalized = normalizeNamePart(state)?.replace(/\s/g, "");
  if (!normalized) return null;
  return sha256(normalized, opts.encoding);
}

/** Indian PIN codes are 6 digits. Meta wants no spaces and lowercase. */
export function hashPostalCode(
  postalCode: string | null | undefined,
  opts: HashOptions = META_HASH_OPTIONS,
): string | null {
  const normalized = postalCode?.trim().toLowerCase().replace(/\s/g, "");
  if (!normalized) return null;
  return sha256(normalized, opts.encoding);
}

/** ISO 3166-1 alpha-2, lowercase. */
export function hashCountry(
  country: string | null | undefined,
  opts: HashOptions = META_HASH_OPTIONS,
): string | null {
  const normalized = country?.trim().toLowerCase();
  if (!normalized || normalized.length !== 2) return null;
  return sha256(normalized, opts.encoding);
}

/**
 * A value is treated as pre-hashed if it is exactly 64 lowercase hex chars.
 *
 * Double-hashing is a classic and completely silent failure: an upstream system
 * sends an already-hashed email, we hash it again, and the digest matches
 * nothing. Cheap to detect, so we always check.
 */
export function looksPreHashed(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value.trim());
}

/** Hash unless the input is already a SHA-256 digest. */
export function hashIfNeeded(
  value: string | null | undefined,
  hasher: (v: string) => string | null,
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (looksPreHashed(trimmed)) return trimmed.toLowerCase();
  return hasher(trimmed);
}
