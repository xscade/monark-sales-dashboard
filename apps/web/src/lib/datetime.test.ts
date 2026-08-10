import { describe, expect, it } from "vitest";
import {
  describeLocalDateTime,
  localDateTimeSchema,
  parseLocalDateTime,
  shiftLocalDateTime,
  toLocalDateTimeInput,
} from "./datetime";

describe("datetime-local conversion", () => {
  it("interprets India-entered times in the organisation timezone", () => {
    expect(parseLocalDateTime("2026-08-10T15:42", "Asia/Kolkata")?.toISOString())
      .toBe("2026-08-10T10:12:00.000Z");
  });

  it("handles a daylight-saving timezone", () => {
    expect(parseLocalDateTime("2026-08-10T15:42", "America/New_York")?.toISOString())
      .toBe("2026-08-10T19:42:00.000Z");
  });

  it("rejects impossible calendar values", () => {
    expect(localDateTimeSchema.safeParse("2026-02-30T12:00").success).toBe(false);
    expect(parseLocalDateTime("2026-02-30T12:00", "Asia/Kolkata")).toBeNull();
  });
});

describe("wall-clock helpers", () => {
  it("renders an instant in the organisation timezone, not the server's", () => {
    const instant = new Date("2026-08-10T10:12:00.000Z");
    expect(toLocalDateTimeInput(instant, "Asia/Kolkata")).toBe("2026-08-10T15:42");
    expect(toLocalDateTimeInput(instant, "America/New_York")).toBe("2026-08-10T06:12");
  });

  it("shifts by calendar days and pins the time of day", () => {
    expect(shiftLocalDateTime("2026-08-10T15:42", { days: 1, hour: 10 })).toBe("2026-08-11T10:00");
    expect(shiftLocalDateTime("2026-08-10T15:42", { days: 7, hour: 10 })).toBe("2026-08-17T10:00");
  });

  it("rolls over month and year boundaries", () => {
    expect(shiftLocalDateTime("2026-12-30T09:00", { days: 3, hour: 10 })).toBe("2027-01-02T10:00");
  });

  it("keeps the wall-clock time when no hour is pinned", () => {
    expect(shiftLocalDateTime("2026-08-10T15:42", { days: 1 })).toBe("2026-08-11T15:42");
  });

  it("refuses a value it cannot parse", () => {
    expect(shiftLocalDateTime("not-a-date", { days: 1 })).toBeNull();
    expect(describeLocalDateTime("not-a-date")).toBeNull();
  });

  it("describes a wall clock without shifting it into another zone", () => {
    expect(describeLocalDateTime("2026-08-11T10:00")).toContain("11 Aug");
    expect(describeLocalDateTime("2026-08-11T10:00")).toContain("10:00");
  });
});
