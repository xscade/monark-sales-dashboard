import { runOutboxDrain } from "../../apps/api/src/cron";

/**
 * Outbox drain, invoked by cron-job.org.
 *
 * All logic lives in `apps/api/src/cron.ts` so the local dev server can mount
 * the identical handler and the cron path is testable before it is deployed.
 *
 * Kept as its own function rather than folded into `api/index.ts`: this one
 * pulls in the connectors and google-auth-library, and bundling that into the
 * ingestion API would make the hot path carry a much heavier cold start.
 *
 * maxDuration is set in vercel.json, not here — see the note in api/index.ts.
 */
export default async function handler(request: Request): Promise<Response> {
  return runOutboxDrain(request);
}
