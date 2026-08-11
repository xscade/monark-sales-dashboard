import { formatDateTime } from "@/lib/format";
import { groupTimeline, type TimelineEntry, type TimelineKind } from "@/lib/timeline";
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
 * They were drifting apart — different groupings, different colours, different
 * wording for the same visit — which made one person's history look like two
 * unrelated records depending on which page you opened. Same component, same
 * story.
 */
export function Timeline({
  entries,
  emptyTitle = "Nothing logged yet",
  timezone,
}: {
  entries: TimelineEntry[];
  emptyTitle?: string;
  timezone?: string;
}) {
  const moments = groupTimeline(entries);
  if (moments.length === 0) return <EmptyState title={emptyTitle} />;

  return (
    <ol className="relative space-y-0 px-5 py-4">
      {moments.map((moment, index) => (
        <li key={`${moment.at.toISOString()}-${index}`} className="relative flex gap-3 pb-4 last:pb-0">
          <div className="flex flex-col items-center">
            <span
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotClass[moment.headline.kind]}`}
            />
            {index < moments.length - 1 && (
              <span className="mt-1 w-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              {/* Sentence case, not Title Case: these are real sentences
                  somebody typed, and capitalising every word made them read
                  like headlines. Only the machine-built ones need the lift. */}
              <p className="text-sm font-medium first-letter:uppercase">{moment.headline.title}</p>
              <time className="shrink-0 text-xs text-zinc-500" dateTime={moment.at.toISOString()}>
                {formatDateTime(moment.at, timezone)}
              </time>
            </div>

            {moment.headline.detail && (
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-400">
                {moment.headline.detail}
              </p>
            )}
            {moment.headline.meta && (
              <p className="mt-0.5 truncate text-xs text-zinc-500">{moment.headline.meta}</p>
            )}

            {moment.facets.length > 0 && (
              <ul className="mt-2 space-y-1 border-l border-zinc-200 pl-3 dark:border-zinc-800">
                {moment.facets.map((facet, facetIndex) => (
                  <li key={facetIndex} className="flex items-start gap-2">
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dotClass[facet.kind]}`}
                    />
                    <span className="min-w-0">
                      <span className="block text-xs font-medium text-zinc-600 first-letter:uppercase dark:text-zinc-400">
                        {facet.title}
                      </span>
                      {facet.detail && (
                        <span className="block whitespace-pre-wrap text-xs text-zinc-500">
                          {facet.detail}
                        </span>
                      )}
                      {facet.meta && (
                        <span className="block truncate text-[11px] text-zinc-400">{facet.meta}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
