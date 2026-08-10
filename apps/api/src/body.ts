export const MAX_REQUEST_BODY_BYTES = 64 * 1024;

export class RequestBodyError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413,
  ) {
    super(message);
    this.name = "RequestBodyError";
  }
}

export interface BoundedRequestBody {
  /** Literal request bytes used for HMAC and request hashing. */
  bytes: Uint8Array;
  /** Strict UTF-8 decoding used for JSON parsing and validation. */
  text: string;
}

/**
 * Read a request body without ever buffering more than `maxBytes`.
 *
 * `Request.text()` buffers the entire payload before the application can
 * inspect its size, which lets a valid public key turn one serverless instance
 * into an unbounded memory sink. This reader checks both Content-Length and
 * every streamed chunk, then decodes only valid UTF-8 so HMAC verification and
 * JSON parsing operate on the same canonical bytes.
 */
export async function readBoundedRequestBody(
  request: Request,
  maxBytes = MAX_REQUEST_BODY_BYTES,
): Promise<BoundedRequestBody> {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("maxBytes must be a positive integer");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength.trim())) {
    const declaredBytes = Number(contentLength);
    if (declaredBytes > maxBytes) {
      await request.body?.cancel("declared request body limit exceeded").catch(() => undefined);
      throw new RequestBodyError(`Request body exceeds ${maxBytes} bytes`, 413);
    }
  }

  if (!request.body) return { bytes: new Uint8Array(), text: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("request body limit exceeded").catch(() => undefined);
        throw new RequestBodyError(`Request body exceeds ${maxBytes} bytes`, 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return {
      bytes,
      // A decoder may omit a leading BOM from the text, which is useful for
      // JSON parsing, but the literal bytes above remain the HMAC input.
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  } catch {
    throw new RequestBodyError("Request body must be valid UTF-8", 400);
  }
}
