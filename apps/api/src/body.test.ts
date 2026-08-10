import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_REQUEST_BODY_BYTES,
  RequestBodyError,
  readBoundedRequestBody,
} from "./body";

test("reads a small streamed JSON body exactly", async () => {
  const body = JSON.stringify({ name: "Buyer", phone: "+919999999999" });
  const request = new Request("https://example.test/v1/leads", {
    method: "POST",
    body,
  });

  const result = await readBoundedRequestBody(request);
  assert.equal(result.text, body);
  assert.deepEqual(result.bytes, new TextEncoder().encode(body));
});

test("preserves a UTF-8 BOM in the signed bytes while decoding JSON text", async () => {
  const json = '{"phone":"+919999999999"}';
  const jsonBytes = new TextEncoder().encode(json);
  const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...jsonBytes]);
  const request = new Request("https://example.test/v1/leads", {
    method: "POST",
    body: bytes,
  });

  const result = await readBoundedRequestBody(request);
  assert.equal(result.text, json);
  assert.deepEqual(result.bytes, bytes);
});

test("rejects an oversized declared Content-Length without reading the body", async () => {
  const request = new Request("https://example.test/v1/leads", {
    method: "POST",
    headers: { "Content-Length": String(MAX_REQUEST_BODY_BYTES + 1) },
    body: "{}",
  });

  await assert.rejects(
    readBoundedRequestBody(request),
    (error: unknown) => error instanceof RequestBodyError && error.status === 413,
  );
});

test("stops a chunked stream once it crosses the 64 KiB bound", async () => {
  const chunk = new Uint8Array(40 * 1024);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(chunk);
      controller.enqueue(chunk);
      controller.close();
    },
  });
  const request = new Request("https://example.test/v1/leads", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  await assert.rejects(
    readBoundedRequestBody(request),
    (error: unknown) => error instanceof RequestBodyError && error.status === 413,
  );
});

test("rejects malformed UTF-8", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.from([0xc3, 0x28]));
      controller.close();
    },
  });
  const request = new Request("https://example.test/v1/leads", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  await assert.rejects(
    readBoundedRequestBody(request),
    (error: unknown) => error instanceof RequestBodyError && error.status === 400,
  );
});
