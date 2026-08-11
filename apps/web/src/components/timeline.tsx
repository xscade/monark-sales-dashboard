import { formatDateTime } from "@/lib/format";
import { sortTimeline, type TimelineEntry, type TimelineKind } from "@/lib/timeline";
import { EmptyState } from "@/components/ui";

const dotClass: Record<TimelineKind, string> = {
  touchpoint: "bg-brand-500",
  stage: "bg-emerald-500",
  assignment: "bg-violet-500",
  activity: "bg-zinc-400",
  visit: "bg-amber-500",
  task: "bg-blue-500",
};

/**
 * One log, shared by the lead and customer screens.
 *
 * They were drifting apart — different colours, different wording for the same
 * visit — which made one person's history look like two unrelated records
 * depending on which page you opened.
 */
export function Timeline({
  entries,
  emptyTitle = "Nothing logged yet",
  timezone,
  limit = 150,
}: {
  entries: TimelineEntry[];
  emptyTitle?: string;
  timezone?: string;
  limit?: number;
}) {
  const items = sortTimeline(entries).slice(0, limit);
  if (items.length === 0) return <EmptyState title={emptyTitle} />;

  return (
    <ol className="relative space-y-0 px-5 py-4">
      {items.map((item, index) => (
        <li key={`${item.at.toISOString()}-${index}`} className="relative flex gap-3 pb-4 last:pb-0">
          <div className="flex flex-col items-center">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotClass[item.kind]}`} />
            {index < items.length - 1 && (
              <span className="mt-1 w-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              {/* Sentence case, not Title Case: these are sentences somebody
                  typed, and capitalising every word made them read like
                  headlines. Only the machine-built ones need the first letter. */}
              <p className="text-sm font-medium first-letter:uppercase">{item.title}</p>
              <time className="shrink-0 text-xs text-zinc-500" dateTime={item.at.toISOString()}>
                {formatDateTime(item.at, timezone)}
              </time>
            </div>
            {item.detail && (
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-400">
                {item.detail}
              </p>
            )}
            {item.meta && <p className="mt-0.5 truncate text-xs text-zinc-500">{item.meta}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
