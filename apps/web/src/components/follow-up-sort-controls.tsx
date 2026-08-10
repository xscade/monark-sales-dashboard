"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ArrowUpDown, Info, RotateCcw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_FOLLOW_UP_SORTS,
  FOLLOW_UP_SORTS,
  FOLLOW_UP_SORT_HINTS,
  FOLLOW_UP_SORT_LABELS,
  type FollowUpSort,
} from "@/lib/follow-ups";
import { cn } from "@/lib/utils";

export function FollowUpSortControls({
  active,
  fromOverview,
  overdueCount,
}: {
  active: FollowUpSort[];
  fromOverview: boolean;
  overdueCount: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function apply(next: FollowUpSort[]) {
    const query = new URLSearchParams(params.toString());
    // An empty `sort` must survive the round trip: absent means "give me the
    // defaults", empty means "the user deliberately turned sorting off".
    query.set("sort", next.join(","));
    query.delete("page");
    startTransition(() => router.replace(`/follow-ups?${query.toString()}`, { scroll: false }));
  }

  function toggle(sort: FollowUpSort, on: boolean) {
    const next = on
      ? FOLLOW_UP_SORTS.filter((key) => key === sort || active.includes(key))
      : active.filter((key) => key !== sort);
    apply(next);
  }

  const overdueOn = active.includes("overdue");
  const isDefault =
    active.length === DEFAULT_FOLLOW_UP_SORTS.length &&
    DEFAULT_FOLLOW_UP_SORTS.every((sort) => active.includes(sort));

  return (
    <div className={cn("space-y-3", pending && "opacity-70")}>
      {/* Arriving from the overview's overdue tile, the one question the person
          already asked deserves its own control — not a checkbox buried among
          five others they have to go find. */}
      {fromOverview && (
        <div className="rounded-xl border border-red-200 bg-red-50/60 p-4 dark:border-red-900/60 dark:bg-red-950/25">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold">Overdue first</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                You came here from the overdue tile, so the {overdueCount} overdue follow-up
                {overdueCount === 1 ? " is" : "s are"} at the top. Turn this off to see the list in
                its natural order.
              </p>
            </div>
            <Switch
              checked={overdueOn}
              onCheckedChange={(checked) => toggle("overdue", checked)}
              aria-label="Show overdue follow-ups first"
            />
          </div>
          <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            You can also sort by score, stage or staleness using the sort options below — they
            stack, so overdue-then-score works.
          </p>
        </div>
      )}

      <details className="rounded-xl border bg-card" open={!fromOverview}>
        <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
          <span className="flex items-center gap-2">
            <ArrowUpDown aria-hidden className="size-4" />
            Sort
            <span className="text-xs font-normal text-muted-foreground">
              {active.length === 0
                ? "unsorted"
                : active.map((sort) => FOLLOW_UP_SORT_LABELS[sort]).join(" → ")}
            </span>
          </span>
        </summary>

        <div className="space-y-2.5 border-t px-4 py-4">
          <p className="text-xs text-muted-foreground">
            Tick as many as you like — they apply in the order shown here, so the list stays
            predictable. Untick everything to leave it unsorted.
          </p>
          {FOLLOW_UP_SORTS.map((sort) => {
            const checked = active.includes(sort);
            return (
              <label key={sort} className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => toggle(sort, event.target.checked)}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>
                  <span className="block font-medium">
                    {FOLLOW_UP_SORT_LABELS[sort]}
                    {checked && (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        #{active.indexOf(sort) + 1}
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {FOLLOW_UP_SORT_HINTS[sort]}
                  </span>
                </span>
              </label>
            );
          })}

          <div className="flex flex-wrap gap-2 border-t pt-3">
            <button
              type="button"
              onClick={() => apply([])}
              disabled={active.length === 0}
              className="rounded-lg border px-2.5 py-1.5 text-xs font-medium transition hover:bg-muted disabled:opacity-40"
            >
              Unsort
            </button>
            <button
              type="button"
              onClick={() => apply(DEFAULT_FOLLOW_UP_SORTS)}
              disabled={isDefault}
              className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition hover:bg-muted disabled:opacity-40"
            >
              <RotateCcw aria-hidden className="size-3" />
              Reset to default
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}
