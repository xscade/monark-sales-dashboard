import { getRequestListener } from "@hono/node-server";
import { runOutboxDrain } from "../../apps/api/src/cron";

/**
 * Outbox drain, invoked by cron-job.org.
 *
 * All logic lives in `apps/api/src/cron.ts` so the local dev server can mount
 * the identical handler and the cron path is testable before it is deployed.
 *
 * Wrapped in `getRequestListener` for the same reason as api/index.ts: Vercel's
 * Node launcher passes `(req, res)`, and an unwrapped Web handler receives a
 * Node IncomingMessage — which fails on `request.headers.get is not a function`
 * the moment it tries to read the bearer token.
 *
 * Kept as its own function rather than folded into api/index.ts: this one pulls
 * in the connectors and google-auth-library, and bundling that into the
 * ingestion API would make the hot path carry a much heavier cold start.
 */
export default getRequestListener(runOutboxDrain);
