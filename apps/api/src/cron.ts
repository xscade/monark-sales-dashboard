import { getDb } from "@monark/db";
import { getOutboxLagMinutes, processOutbox, reclaimStalled } from "@monark/services";
import { timingSafeEqual } from "node:crypto";

/**
 * Outbox drain, invoked by an external scheduler (cron-job.org).
 *
 * Lives here rather than directly in `api/cron/outbox.ts` so the local dev
 * server can mount the exact same handler. Otherwise the cron path is
 * untestable until it is deployed — and "deploy and see" is a poor way to
 * discover that your bearer token is wrong.
 *
 * ── The budget is set by the SCHEDULER, not by Vercel ────────────────────
 * cron-job.org aborts its connection at 30 seconds. Aborting the connection
 * does NOT stop the function — Vercel keeps running it — so a longer budget
 * would mean work quietly completes while every run is reported failed. That
 * turns the failure notification into noise, and noisy alerts get muted, which
 * is exactly how the lag alarm below stops working.
 *
 * So: finish inside ~20s and run often. Given Meta's 7-day event_time limit,
 * drain frequency was never the constraint; honest signalling is.
 */

export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;

  // Fail closed. An unset secret would leave the endpoint open to anyone who
  // guesses the path, and forcing a drain against a misconfigured destination
  // burns the retry budget on permanent errors.
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function runOutboxDrain(request: Request): Promise<Response> {
  if (!isCronAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const db = getDb();

  // Default sized for cron-job.org's 30s abort, leaving headroom for the lag
  // query and the response. Raise it only for a scheduler that waits longer.
  const timeBudgetMs = Number(process.env.OUTBOX_TIME_BUDGET_MS ?? 20_000);

  try {
    // Recover anything stranded by a previous invocation that was killed.
    const reclaimed = await reclaimStalled(db);

    const result = await processOutbox(db, {
      batchSize: Number(process.env.WORKER_BATCH_SIZE ?? 200),
      timeBudgetMs,
    });

    const lagMinutes = await getOutboxLagMinutes(db);
    const threshold = Number(process.env.OUTBOX_LAG_ALERT_MINUTES ?? 180);
    const lagCritical = lagMinutes > threshold;

    const body = {
      ok: !lagCritical,
      reclaimed,
      ...result,
      lagMinutes,
      lagThresholdMinutes: threshold,
      totalMs: Date.now() - startedAt,
      ...(lagCritical
        ? {
            alert:
              `Outbox lag is ${lagMinutes} minutes. Meta discards events older than ` +
              `7 days — conversions will be permanently lost if this is not cleared.`,
          }
        : {}),
    };

    console.log(JSON.stringify({ level: lagCritical ? "error" : "info", ...body }));

    // Non-2xx on critical lag so the scheduler's failure notification fires.
    // cron-job.org treats any non-2xx as a failed execution.
    return Response.json(body, { status: lagCritical ? 500 : 200 });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "Outbox drain failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return Response.json({ error: "Outbox drain failed" }, { status: 500 });
  }
}
