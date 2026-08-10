import app from "../apps/api/src/app";

/**
 * Vercel serverless entry point.
 *
 * `vercel.json` rewrites /health and /v1/* here, so Hono keeps doing the
 * routing and the deployment stays a single function rather than one per
 * endpoint — each distinct function gets its own cold start and its own
 * connection pool to Supabase.
 *
 * `app.fetch` is `(Request) => Promise<Response>`, which is exactly the
 * Web-standard signature Vercel's Node runtime accepts — the same shape as
 * api/cron/outbox.ts. Using it directly rather than `hono/vercel`'s `handle`,
 * which is really the Next.js App Router adapter: one less layer, and both
 * functions now succeed or fail together instead of for different reasons.
 *
 * No `export const config` here on purpose. Runtime and maxDuration are
 * declared once, in vercel.json's `functions` block. An unrecognised `runtime`
 * value makes the builder skip the function entirely, which presents as a 404
 * on every route with no error anywhere.
 */
export default app.fetch;
