import { runOutboxDrain } from "../../apps/api/src/cron";

/**
 * Vercel wrapper. All logic lives in `apps/api/src/cron.ts` so the local dev
 * server can mount the identical handler and the cron path is testable before
 * it is deployed.
 *
 * Kept as its own function rather than folded into `api/index.ts`: this one
 * pulls in the connectors and google-auth-library, and bundling that into the
 * ingestion API would make the hot path carry a much heavier cold start.
 */
export const config = {
  runtime: "nodejs",
  /**
   * Above the 20s drain budget so a slow platform response can still finish and
   * be recorded, but within Vercel Hobby's 60s ceiling. Since the schedule now
   * comes from cron-job.org rather than Vercel Cron, this project no longer
   * needs a Pro plan.
   */
  maxDuration: 60,
};

export default async function handler(request: Request): Promise<Response> {
  return runOutboxDrain(request);
}
