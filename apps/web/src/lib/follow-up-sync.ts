import type { getDb } from "@monark/db";
import { sql } from "drizzle-orm";

type DbTx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * `leads.next_follow_up_at` is derived, never authored.
 *
 * The open follow-up tasks are the truth; the column is a denormalised copy so
 * list screens do not have to join and aggregate on every render. Any writer
 * that sets the column directly will disagree with the task list the moment a
 * task is completed or rescheduled, so every path that touches follow-up tasks
 * calls this instead.
 */
export async function syncLeadNextFollowUp(
  tx: DbTx,
  orgId: string,
  leadId: string,
): Promise<void> {
  await tx.execute(sql`
    UPDATE leads
    SET next_follow_up_at = (
          SELECT MIN(a.due_at)
          FROM activities a
          WHERE a.org_id = ${orgId}
            AND a.lead_id = ${leadId}
            AND a.type = 'task'
            AND a.completed_at IS NULL
            AND a.due_at IS NOT NULL
        ),
        updated_at = now()
    WHERE org_id = ${orgId} AND id = ${leadId}
  `);
}
