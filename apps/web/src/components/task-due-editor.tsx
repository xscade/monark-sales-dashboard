"use client";

import { useState } from "react";
import { rescheduleTask } from "@/lib/sales-actions";
import { SubmitButton } from "@/components/ui";

/**
 * Reschedule control for a task row.
 *
 * Save appears only once the date has actually been changed. A button sitting
 * permanently beside a filled-in field reads as "this needs saving", which on a
 * list of twenty tasks is twenty false alarms — and the old label, "Move",
 * collided with moving a card between pipeline stages, a different action
 * entirely.
 */
export function TaskDueEditor({
  taskId,
  returnTo,
  defaultValue,
  label,
}: {
  taskId: string;
  returnTo: string;
  defaultValue: string;
  label: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const changed = value !== defaultValue && value !== "";

  return (
    <form action={rescheduleTask} className="flex items-center gap-1.5">
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <input
        type="datetime-local"
        name="dueAt"
        required
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-label={label}
        className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-950"
      />
      {changed && <SubmitButton variant="secondary">Save</SubmitButton>}
    </form>
  );
}
