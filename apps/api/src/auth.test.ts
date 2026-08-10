import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import type { Database } from "@monark/db";
import {
  consumeRateLimit,
  isRequiredSignatureMissing,
  verifySignature,
} from "./auth";

test("server policy requires a signature while browser policy does not", () => {
  assert.equal(isRequiredSignatureMissing({ signatureRequired: true }, undefined), true);
  assert.equal(isRequiredSignatureMissing({ signatureRequired: true }, "t=1,v1=abc"), false);
  assert.equal(isRequiredSignatureMissing({ signatureRequired: false }, undefined), false);
});

test("verifies a timestamped HMAC and rejects tampering", () => {
  const now = new Date("2026-08-10T10:00:00.000Z");
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const rawBody = '{"phone":"+919999999999"}';
  const secret = "test-signing-secret";
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  const header = `t=${timestamp},v1=${signature}`;

  assert.deepEqual(verifySignature({ header, rawBody, secret, now }), { ok: true });
  assert.equal(verifySignature({ header, rawBody: `${rawBody} `, secret, now }).ok, false);
});

test("distributed limiter allows only when the atomic UPSERT returns a row", async () => {
  const allowDb = {
    execute: async () => ({ rows: [{ requestCount: 1 }] }),
  } as unknown as Database;
  const denyDb = {
    execute: async () => ({ rows: [] }),
  } as unknown as Database;

  assert.equal(
    await consumeRateLimit(
      allowDb,
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      60,
    ),
    true,
  );
  assert.equal(
    await consumeRateLimit(
      denyDb,
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      60,
    ),
    false,
  );
});
