import { runOutboxDrain } from "@monark/api";

/**
 * Conversion outbox drain, invoked by cron-job.org.
 *
 * Its own route rather than folding into the /v1 handler, so it can carry a
 * longer `maxDuration` without giving the ingestion hot path the same ceiling.
 *
 * The 20-second drain budget inside `runOutboxDrain` is sized for
 * cron-job.org's 30-second abort, not for this limit — see
 * apps/api/src/cron.ts.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = (request: Request) => runOutboxDrain(request);
export const POST = (request: Request) => runOutboxDrain(request);
