import { z } from "zod";

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function localParts(value: string) {
  const match = LOCAL_DATE_TIME.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const parts = [year, month, day, hour, minute].map(Number);
  const probe = new Date(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!, parts[3]!, parts[4]!));
  if (
    probe.getUTCFullYear() !== parts[0] ||
    probe.getUTCMonth() !== parts[1]! - 1 ||
    probe.getUTCDate() !== parts[2] ||
    probe.getUTCHours() !== parts[3] ||
    probe.getUTCMinutes() !== parts[4]
  ) return null;
  return { year: parts[0]!, month: parts[1]!, day: parts[2]!, hour: parts[3]!, minute: parts[4]! };
}
export const localDateTimeSchema = z
  .string()
  .regex(LOCAL_DATE_TIME, "Choose a valid date and time")
  .refine((value) => Boolean(localParts(value)), "Choose a valid date and time");

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"), month: value("month"), day: value("day"),
    hour: value("hour"), minute: value("minute"), second: value("second"),
  };
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

/** Render an instant as the `datetime-local` string an input expects, in `timeZone`. */
export function toLocalDateTimeInput(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone);
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/**
 * Move a wall-clock value by whole days, optionally pinning the time of day.
 *
 * Deliberately calendar arithmetic rather than millisecond arithmetic: "the day
 * after tomorrow at 10am" must stay 10am across a daylight-saving boundary, and
 * the value is re-anchored to a real instant later anyway, by whoever parses it
 * in the user's timezone.
 */
export function shiftLocalDateTime(
  value: string,
  { days = 0, hour, minute = 0 }: { days?: number; hour?: number; minute?: number },
): string | null {
  const parts = localParts(value);
  if (!parts) return null;
  const shifted = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days, hour ?? parts.hour, hour === undefined ? parts.minute : minute),
  );
  return [
    `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
  ].join("T");
}

/**
 * Human-readable form of a wall-clock value — "Tue, 12 Aug, 10:00 am".
 *
 * Formats the value as written rather than converting it, because a
 * `datetime-local` string has no timezone to convert from.
 */
export function describeLocalDateTime(value: string): string | null {
  const parts = localParts(value);
  if (!parts) return null;
  const asUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute));
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(asUtc);
}

/** Convert a browser `datetime-local` value into its real UTC instant. */
export function parseLocalDateTime(value: string, timeZone: string): Date | null {
  const wanted = localParts(value);
  if (!wanted) return null;
  const wallClockAsUtc = Date.UTC(
    wanted.year, wanted.month - 1, wanted.day, wanted.hour, wanted.minute,
  );

  try {
    // Resolve twice because the initial UTC guess can fall on the other side of
    // a daylight-saving boundary from the intended local instant.
    const first = new Date(wallClockAsUtc);
    const firstParts = zonedParts(first, timeZone);
    const firstOffset = Date.UTC(
      firstParts.year, firstParts.month - 1, firstParts.day,
      firstParts.hour, firstParts.minute, firstParts.second,
    ) - first.getTime();
    const second = new Date(wallClockAsUtc - firstOffset);
    const secondParts = zonedParts(second, timeZone);
    const secondOffset = Date.UTC(
      secondParts.year, secondParts.month - 1, secondParts.day,
      secondParts.hour, secondParts.minute, secondParts.second,
    ) - second.getTime();
    const result = new Date(wallClockAsUtc - secondOffset);
    const resolved = zonedParts(result, timeZone);

    // Reject nonexistent wall-clock times during a DST jump rather than
    // silently moving the appointment by an hour.
    if (
      resolved.year !== wanted.year || resolved.month !== wanted.month ||
      resolved.day !== wanted.day || resolved.hour !== wanted.hour ||
      resolved.minute !== wanted.minute
    ) return null;
    return result;
  } catch {
    return null;
  }
}
