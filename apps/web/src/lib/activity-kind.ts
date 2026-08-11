import { sql, type SQL } from "drizzle-orm";

/**
 * Follow-ups and tasks are stored in the same table, and used to be the same
 * list.
 *
 * Both screens read `activities WHERE type = 'task'`, so a follow-up booked by
 * moving a pipeline card appeared on the Follow-ups page *and* on the Tasks
 * page — one record, shown twice, with nothing to say which screen was
 * authoritative. That is the redundancy: not that tasks were created behind
 * anyone's back, but that the same row was being presented as two things.
 *
 * They are now two lists that never overlap:
 *
 *   follow_up — the callback queue. Written when a lead advances and somebody
 *               answers "what happens next". Drives `leads.next_follow_up_at`.
 *   task      — a manual note or to-do. Only ever created by someone typing it
 *               on the Tasks page. Nothing writes one automatically.
 */
export const ACTIVITY_KINDS = ["follow_up", "task"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export function isActivityKind(value: unknown): value is ActivityKind {
  return ACTIVITY_KINDS.includes(value as ActivityKind);
}

/**
 * Rows belonging to the callback queue.
 *
 * Anything unmarked counts as a follow-up. The two defaults are deliberately
 * asymmetric: an untagged row stays visible in the queue that chases customers
 * rather than falling out of the product, while the Tasks list below demands an
 * explicit tag so it can never quietly re-fill with generated rows.
 */
export function isFollowUp(alias: string): SQL {
  return sql.raw(`COALESCE(${alias}.metadata ->> 'kind', 'follow_up') = 'follow_up'`);
}

/** Rows belonging to the manual Tasks list. Strict: unmarked rows are excluded. */
export function isManualTask(alias: string): SQL {
  return sql.raw(`${alias}.metadata ->> 'kind' = 'task'`);
}
