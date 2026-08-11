/**
 * The merged activity log shown on the lead and customer screens.
 *
 * One thing happening in the real world writes to several tables. A visitor
 * checking in at the gate produces a touchpoint, a visit, a stage change, an
 * assignment and an activity — five rows describing one moment. Rendering a row
 * per table made the log read like the database's diary rather than the
 * customer's, so the rows that only restate what another row already said are
 * left out rather than shown.
 */

export type TimelineKind =
  | "touchpoint"
  | "stage"
  | "assignment"
  | "activity"
  | "visit"
  | "task";

export interface TimelineEntry {
  at: Date;
  kind: TimelineKind;
  title: string;
  detail?: string | null;
  meta?: string | null;
}

/**
 * Is this stage change worth a line of its own?
 *
 * Automatic ones are not. "New → Visited" written by the check-in form restates
 * the check-in that is already in the log directly above it, and a correction
 * applied by a migration is bookkeeping rather than history. A stage change a
 * person made and explained is the opposite — the reason they typed is often
 * the only record of why a deal moved, and nothing else captures it.
 */
export function isNoteworthyStageChange(change: {
  changed_by?: string | null;
  changed_by_user_id?: string | null;
  reason?: string | null;
}): boolean {
  const byAPerson = change.changed_by === "user" || Boolean(change.changed_by_user_id);
  return byAPerson && Boolean(change.reason?.trim());
}

/** Newest first, with unparseable timestamps dropped rather than rendered. */
export function sortTimeline(entries: TimelineEntry[]): TimelineEntry[] {
  return entries
    .filter((entry) => entry.at instanceof Date && !Number.isNaN(entry.at.getTime()))
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}
