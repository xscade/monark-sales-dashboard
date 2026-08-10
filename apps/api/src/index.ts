/**
 * Public surface of the API app.
 *
 * The Hono app and the cron drain are consumed by the Next.js route handlers in
 * `apps/web`, which is the single Vercel deployment. `src/server.ts` still runs
 * the same app standalone for local development or non-Vercel hosting.
 */
export { default as app } from "./app";
export { runOutboxDrain, isCronAuthorized } from "./cron";
