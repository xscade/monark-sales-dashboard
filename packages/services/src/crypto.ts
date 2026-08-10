import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for integration credentials at rest.
 *
 * These are long-lived Meta access tokens and Google service-account private
 * keys — enough to write conversions into the ad accounts, so a database dump
 * must not hand them over in plaintext. GCM rather than CBC because it
 * authenticates the ciphertext: tampering fails loudly instead of decrypting to
 * garbage that then gets sent somewhere.
 *
 * Format: base64(iv[12] || authTag[16] || ciphertext)
 */

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `CREDENTIALS_ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}. ` +
        "Generate with: openssl rand -base64 32",
    );
  }
  return key;
}

export function encryptCredentials(value: Record<string, unknown>): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function decryptCredentials(encoded: string): Record<string, any> {
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Encrypted credentials payload is truncated");
  }

  const iv = buffer.subarray(0, IV_LENGTH);
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}
