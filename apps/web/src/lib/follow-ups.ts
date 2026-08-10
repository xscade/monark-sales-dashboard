import { describeLocalDateTime, shiftLocalDateTime, toLocalDateTimeInput } from "./datetime";

/**
 * Follow-up sorting vocabulary, shared by the page, the query and the controls.
 *
 * Sorts are additive rather than exclusive: a salesperson planning a morning
 * genuinely wants "overdue first, then by score" — a single-choice dropdown
 * forces them to pick which half of that question to answer. Checked keys apply
 * in the fixed precedence below, so the result is predictable no matter what
 * order they were ticked in.
 */
export const FOLLOW_UP_SORTS = [
  "overdue",
  "due",
  "score",
  "stage",
  "stale",
  "owner",
] as const;

export type FollowUpSort = (typeof FOLLOW_UP_SORTS)[number];

export const FOLLOW_UP_SORT_LABELS: Record<FollowUpSort, string> = {
  overdue: "Overdue first",
  due: "Soonest due first",
  score: "Highest score first",
  stage: "Furthest along the funnel",
  stale: "Longest since contact",
  owner: "Owner A–Z",
};

export const FOLLOW_UP_SORT_HINTS: Record<FollowUpSort, string> = {
  overdue: "Anything past its due time floats to the top",
  due: "Plan the day in the order it has to happen",
  score: "Work the most valuable buyers before the rest",
  stage: "Late-funnel deals first — they are the ones at risk",
  stale: "Surfaces the ones quietly going cold",
  owner: "Group a team list by who owns it",
};

export const DEFAULT_FOLLOW_UP_SORTS: FollowUpSort[] = ["overdue", "due"];

export function isFollowUpSort(value: string): value is FollowUpSort {
  return (FOLLOW_UP_SORTS as readonly string[]).includes(value);
}

/**
 * Reads `?sort=` — an explicit empty value means "unsorted", which is different
 * from the parameter being absent and getting the defaults.
 */
export function parseFollowUpSorts(raw: string | undefined): FollowUpSort[] {
  if (raw === undefined) return DEFAULT_FOLLOW_UP_SORTS;
  const picked = raw.split(",").map((part) => part.trim()).filter(isFollowUpSort);
  // Normalise to the canonical precedence so the URL cannot express an order
  // the query does not honour.
  return FOLLOW_UP_SORTS.filter((sort) => picked.includes(sort));
}

export const FOLLOW_UP_SCOPES = ["due", "missing", "all"] as const;
export type FollowUpScope = (typeof FOLLOW_UP_SCOPES)[number];

export const FOLLOW_UP_SCOPE_LABELS: Record<FollowUpScope, string> = {
  due: "Scheduled",
  missing: "No follow-up set",
  all: "Everything open",
};

export function normalizeFollowUpScope(value: string | undefined): FollowUpScope {
  return value === "missing" || value === "all" ? value : "due";
}

/** Channels worth distinguishing, because they carry different intent. */
export const FOLLOW_UP_CHANNELS = [
  "call",
  "whatsapp",
  "meeting",
  "site_visit",
  "email",
] as const;

export type FollowUpChannel = (typeof FOLLOW_UP_CHANNELS)[number];

export const FOLLOW_UP_CHANNEL_LABELS: Record<FollowUpChannel, string> = {
  call: "Phone call",
  whatsapp: "WhatsApp",
  meeting: "Meeting",
  site_visit: "Site visit",
  email: "Email",
};

export function isFollowUpChannel(value: string): value is FollowUpChannel {
  return (FOLLOW_UP_CHANNELS as readonly string[]).includes(value);
}

export interface ReschedulePreset {
  key: string;
  label: string;
  /** `datetime-local` value, already expressed in the user's timezone. */
  value: string;
  /** The same moment spelled out, so nobody has to decode the raw value. */
  hint: string;
}

/** Morning slot the day-shifting presets land on — before the working day fills up. */
const PRESET_HOUR = 10;

/**
 * The four answers to "when instead?" that cover almost every reschedule.
 *
 * Computed on the server from the org's timezone rather than in the browser:
 * the reschedule action interprets the submitted wall clock in the *user's*
 * timezone, so a laptop set to another zone would otherwise book the call an
 * hour or a day out without ever saying so.
 */
export function buildReschedulePresets(now: Date, timeZone: string): ReschedulePreset[] {
  const base = toLocalDateTimeInput(now, timeZone);
  const inAnHour = toLocalDateTimeInput(new Date(now.getTime() + 60 * 60 * 1000), timeZone);
  const candidates = [
    { key: "hour", label: "In an hour", value: inAnHour },
    { key: "tomorrow", label: "Tomorrow", value: shiftLocalDateTime(base, { days: 1, hour: PRESET_HOUR }) },
    { key: "three-days", label: "In 3 days", value: shiftLocalDateTime(base, { days: 3, hour: PRESET_HOUR }) },
    { key: "next-week", label: "Next week", value: shiftLocalDateTime(base, { days: 7, hour: PRESET_HOUR }) },
  ];

  return candidates.flatMap(({ key, label, value }) => {
    const hint = value ? describeLocalDateTime(value) : null;
    return value && hint ? [{ key, label, value, hint }] : [];
  });
}
