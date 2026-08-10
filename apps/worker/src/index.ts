import { closeDb, getDb } from "@monark/db";
import { getOutboxLagMinutes, processOutbox, reclaimStalled } from "@monark/services";

/**
 * Long-lived outbox worker.
 *
 * OPTIONAL on the Vercel deployment — there, `api/cron/outbox.ts` drains the
 * queue on a schedule instead, because Vercel cannot host a persistent process.
 *
 * Kept because a cron is coarser than a loop: if you later move to Fly, Railway
 * or a plain VM and want sub-minute delivery, this is the same processing logic
 * driven by a loop rather than a schedule. Running BOTH is also safe — the
 * claim query uses FOR UPDATE SKIP LOCKED, so they take disjoint work.
 */

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 15_000);
const BATCH_SIZE = Number(process.env.WORKER_BATCH_SIZE ?? 200);
const LAG_ALERT_MINUTES = Number(process.env.OUTBOX_LAG_ALERT_MINUTES ?? 180);
const RECLAIM_EVERY_TICKS = 20;

let shuttingDown = false;
let tick = 0;

async function runOnce(): Promise<void> {
  const db = getDb();

  // Recover deliveries stranded `in_flight` by a crashed worker. Cheap, and
  // without it a mid-batch kill orphans those rows permanently.
  if (tick % RECLAIM_EVERY_TICKS === 0) {
    const reclaimed = await reclaimStalled(db);
    if (reclaimed > 0) {
      log("warn", `Reclaimed ${reclaimed} stalled deliveries`);
    }
  }

  const result = await processOutbox(db, { batchSize: BATCH_SIZE });

  if (result.claimed > 0) {
    log(
      "info",
      `claimed=${result.claimed} delivered=${result.delivered} ` +
        `ineligible=${result.ineligible} expired=${result.expired} ` +
        `retrying=${result.retrying} failed=${result.permanentlyFailed}`,
    );
  }

  /**
   * Lag alarm.
   *
   * This is the single most important signal the worker produces. Meta rejects
   * events whose event_time is older than 7 days, so sustained lag is not slow
   * reporting — it is conversions being destroyed, silently, while every
   * dashboard still looks healthy.
   */
  const lagMinutes = await getOutboxLagMinutes(db);
  if (lagMinutes > LAG_ALERT_MINUTES) {
    log(
      "error",
      `OUTBOX LAG ${lagMinutes} minutes (threshold ${LAG_ALERT_MINUTES}). ` +
        `Meta discards events older than 7 days — conversions will be permanently lost ` +
        `if this is not cleared.`,
    );
  }

  tick++;
}

async function main(): Promise<void> {
  log("info", `Worker starting — poll=${POLL_INTERVAL_MS}ms batch=${BATCH_SIZE}`);

  if (process.env.CONVERSIONS_DRY_RUN === "true") {
    log("warn", "CONVERSIONS_DRY_RUN=true — destinations may run in validate-only mode");
  }

  while (!shuttingDown) {
    try {
      await runOnce();
    } catch (err) {
      // Never let one bad tick kill the worker; the next poll retries.
      log("error", `Tick failed: ${err instanceof Error ? err.stack : String(err)}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }

  await closeDb();
  log("info", "Worker stopped");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(level: "info" | "warn" | "error", message: string): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    service: "outbox-worker",
    message,
  });
  if (level === "error") console.error(line);
  else console.log(line);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    // Graceful: finish the in-flight tick rather than abandoning claimed rows
    // and forcing the stall-reclaim path to clean up after us.
    log("info", `${signal} received — finishing current tick`);
    shuttingDown = true;
  });
}

main().catch((err) => {
  log("error", `Fatal: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
