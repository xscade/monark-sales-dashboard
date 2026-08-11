import { randomUUID } from "node:crypto";
import { activities, type getDb } from "@monark/db";
import { sql } from "drizzle-orm";
import { FOLLOW_UP_CHANNEL_LABELS, type FollowUpChannel } from "./follow-ups";
import { isFollowUp } from "./activity-kind";

type DbTx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export interface FollowUpDraft {
  at: Date;
  channel: FollowUpChannel;
  note: string | null;
  commitment: string | null;
}

/**
 * Records the next step as a task and refreshes the lead's cached due date.
 *
 * Shared by every route that moves a lead — the stage dialog, the visit
 * workflows, the booking workflow — because "the follow-ups page is up to
 * date" is only true if all of them write the same shape of row.
 */
export async function insertFollowUpTask(
  tx: DbTx,
  input: {
    orgId: string;
    leadId: string;
    personId: string;
    assigneeUserId: string;
    context: string;
    followUp: FollowUpDraft;
  },
): Promise<void> {
  const { at, channel, note, commitment } = input.followUp;
  const body = [note, commitment && `Committed: ${commitment}`].filter(Boolean).join("\n") || null;

  await tx.insert(activities).values({
    id: randomUUID(),
    orgId: input.orgId,
    leadId: input.leadId,
    personId: input.personId,
    type: "task",
    subject: `${FOLLOW_UP_CHANNEL_LABELS[channel]} · ${input.context}`,
    body,
    dueAt: at,
    userId: input.assigneeUserId,
    metadata: { kind: "follow_up", channel, source: "pipeline_stage_change", context: input.context },
    occurredAt: new Date(),
  });

  await syncLeadNextFollowUp(tx, input.orgId, input.leadId);
}

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
            AND ${isFollowUp("a")}
            AND a.completed_at IS NULL
            AND a.due_at IS NOT NULL
        ),
        updated_at = now()
    WHERE org_id = ${orgId} AND id = ${leadId}
  `);
}
