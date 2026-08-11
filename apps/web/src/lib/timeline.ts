/**
 * Turning rows into events.
 *
 * One thing happening in the real world writes to several tables. A visitor
 * checking in at the gate produces a touchpoint, a visit, a stage change, an
 * assignment and an activity — five rows, one moment. Rendering a row per table
 * made the log read like the database's diary rather than the customer's:
 * five near-identical entries stamped with the same minute, the actual detail
 * buried among four restatements of it.
 *
 * So the timeline groups by moment. The entry that best names what happened
 * becomes the headline and the rest hang off it as supporting facts, which
 * keeps every piece of information while saying it once.
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
  /**
   * Only entries sharing a key may merge. Both detail pages fold in events from
   * a person's other opportunities, and two unrelated enquiries touched in the
   * same minute are two moments, not one.
   */
  groupKey?: string | null;
}

export interface TimelineMoment {
  at: Date;
  headline: TimelineEntry;
  /** Everything else that happened in the same moment, already de-duplicated. */
  facets: TimelineEntry[];
}

/**
 * How close in time two rows must be to count as the same moment.
 *
 * The rows a single action writes land within milliseconds of each other; the
 * window only needs to survive a slow transaction. Kept short so a genuine
 * second action a couple of minutes later still reads as its own event.
 */
export const MOMENT_WINDOW_MS = 90_000;

/**
 * Which entry gets to name the moment.
 *
 * An activity carries the subject somebody actually wrote ("New visitor checked
 * in · Windwave Site"), so it wins. An assignment is last not because it is
 * unimportant but because "Assigned to Priya" describes the consequence rather
 * than the event.
 */
const HEADLINE_PRIORITY: Record<TimelineKind, number> = {
  activity: 0,
  task: 1,
  visit: 2,
  stage: 3,
  touchpoint: 4,
  assignment: 5,
};

function lines(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Strip any line already said by the headline, so a facet adds or says nothing. */
function withoutRepetition(entry: TimelineEntry, said: Set<string>): TimelineEntry {
  const kept = lines(entry.detail).filter((line) => !said.has(line.toLowerCase()));
  return { ...entry, detail: kept.length ? kept.join("\n") : null };
}

/**
 * Collapse a flat, newest-first list of rows into moments.
 *
 * Input need not be sorted; output is newest first.
 */
export function groupTimeline(entries: TimelineEntry[]): TimelineMoment[] {
  const sorted = [...entries]
    .filter((entry) => entry.at instanceof Date && !Number.isNaN(entry.at.getTime()))
    .sort((a, b) => b.at.getTime() - a.at.getTime());

  const buckets: TimelineEntry[][] = [];
  for (const entry of sorted) {
    const current = buckets[buckets.length - 1];
    const anchor = current?.[0];
    const sameMoment =
      anchor !== undefined &&
      (anchor.groupKey ?? null) === (entry.groupKey ?? null) &&
      anchor.at.getTime() - entry.at.getTime() <= MOMENT_WINDOW_MS;

    if (sameMoment) current.push(entry);
    else buckets.push([entry]);
  }

  return buckets.map((bucket) => {
    const ranked = [...bucket].sort(
      (a, b) => HEADLINE_PRIORITY[a.kind] - HEADLINE_PRIORITY[b.kind],
    );
    const headline = ranked[0]!;
    const said = new Set(
      [...lines(headline.detail), headline.title].map((line) => line.toLowerCase()),
    );

    const facets: TimelineEntry[] = [];
    for (const entry of ranked.slice(1)) {
      const trimmed = withoutRepetition(entry, said);
      // A facet whose title merely restates the headline and which adds no
      // detail of its own is the redundancy this whole function exists to kill.
      if (said.has(trimmed.title.toLowerCase()) && !trimmed.detail) continue;
      said.add(trimmed.title.toLowerCase());
      for (const line of lines(trimmed.detail)) said.add(line.toLowerCase());
      facets.push(trimmed);
    }

    return { at: headline.at, headline, facets };
  });
}
