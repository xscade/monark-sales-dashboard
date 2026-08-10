import { closeDb, getDb } from "@monark/db";
import { getOutboxLagMinutes, processOutbox, reclaimStalled } from "@monark/services";

/**
 * Single-pass drain from the command line.
 *
 * Useful for draining the queue manually after fixing a misconfigured
 * destination, and for verifying credentials before flipping a destination out
 * of dry-run. On Vercel the equivalent is `api/cron/outbox.ts`.
 *
 * Exits non-zero when lag exceeds the alert threshold, so it also works as a
 * health probe from any external scheduler.
 */
async function main(): Promise<void> {
  const db = getDb();

  const reclaimed = await reclaimStalled(db);
  const result = await processOutbox(db, {
    batchSize: Number(process.env.WORKER_BATCH_SIZE ?? 500),
  });
  const lagMinutes = await getOutboxLagMinutes(db);

  console.log(JSON.stringify({ reclaimed, ...result, lagMinutes }, null, 2));
  await closeDb();

  const threshold = Number(process.env.OUTBOX_LAG_ALERT_MINUTES ?? 180);
  if (lagMinutes > threshold) {
    console.error(`Outbox lag ${lagMinutes}m exceeds threshold ${threshold}m`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
