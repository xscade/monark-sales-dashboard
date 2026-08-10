"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { rescheduleTask } from "@/lib/sales-actions";
import type { ReschedulePreset } from "@/lib/follow-ups";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * "Reschedule" — the control that used to be an unlabelled date box next to a
 * button called "Move".
 *
 * Naming the panel after the thing it changes ("when this follow-up is due")
 * and offering the four dates people actually pick means the common case is one
 * click, and the uncommon case still has the full picker underneath.
 *
 * Two forms, not one: the presets carry their date on the submit button, so a
 * `required` empty picker in the same form would block them.
 */
export function RescheduleFollowUp({
  taskId,
  returnTo,
  presets,
  currentDueLabel,
  leadName,
}: {
  taskId: string;
  returnTo: string;
  presets: ReschedulePreset[];
  currentDueLabel: string | null;
  leadName: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
        <CalendarClock aria-hidden className="size-3.5" />
        Reschedule
      </PopoverTrigger>
      <PopoverContent className="w-80" aria-label={`Reschedule the follow-up for ${leadName}`}>
        <p className="text-sm font-semibold">Reschedule follow-up</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {currentDueLabel
            ? `Currently due ${currentDueLabel}. Pick a new time — the task moves, nothing is marked done.`
            : "Pick when this should come back to you. The task moves, nothing is marked done."}
        </p>

        <form action={rescheduleTask} onSubmit={() => setOpen(false)} className="mt-3 grid grid-cols-2 gap-2">
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          {presets.map((preset) => (
            <button
              key={preset.key}
              type="submit"
              name="dueAt"
              value={preset.value}
              title={preset.hint}
              className="rounded-lg border px-2.5 py-2 text-left text-xs font-medium transition hover:border-brand-500 hover:bg-muted"
            >
              <span className="block">{preset.label}</span>
              <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                {preset.hint}
              </span>
            </button>
          ))}
        </form>

        <form action={rescheduleTask} onSubmit={() => setOpen(false)} className="mt-3 border-t pt-3">
          <input type="hidden" name="taskId" value={taskId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <label htmlFor={`due-${taskId}`} className="text-xs font-medium">
            Or choose a date and time
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              id={`due-${taskId}`}
              type="datetime-local"
              name="dueAt"
              required
              className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-950"
            />
            <button
              type="submit"
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-700"
            >
              Reschedule
            </button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
