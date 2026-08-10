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
