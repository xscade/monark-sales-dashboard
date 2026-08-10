import { getRequestListener } from "@hono/node-server";
import app from "../apps/api/src/app";

/**
 * Vercel serverless entry point.
 *
 * Exported as a Node-style `(req, res)` listener, NOT the Web-standard
 * `(Request) => Response`. Vercel's Node launcher calls the default export with
 * `(req, res)` and ignores the return value, so exporting `app.fetch` directly
 * produces a function that builds a perfectly good Response which is then
 * dropped on the floor — the request hangs until the 30s timeout.
 *
 * `@vercel/node` normally detects a Web-style handler and wraps it. This build
 * uses the Build Output API directly (see scripts/build-vercel.mjs), so the
 * wrapping is ours to do. `getRequestListener` is exactly that adapter, and it
 * is the same one the local dev server uses — so both paths run identical code.
 */
export default getRequestListener(app.fetch);
