import { describe, expect, it } from "vitest";
import {
  buildReschedulePresets,
  DEFAULT_FOLLOW_UP_SORTS,
  normalizeFollowUpScope,
  parseFollowUpSorts,
} from "./follow-ups";

describe("parseFollowUpSorts", () => {
  it("distinguishes an absent parameter from a deliberately empty one", () => {
    // The whole "unsort" control depends on this: no `sort` key means a first
    // visit and should get the defaults, while `sort=` means the user turned
    // every sort off and must not have them silently reinstated.
    expect(parseFollowUpSorts(undefined)).toEqual(DEFAULT_FOLLOW_UP_SORTS);
    expect(parseFollowUpSorts("")).toEqual([]);
  });

  it("normalises to the canonical precedence regardless of URL order", () => {
    expect(parseFollowUpSorts("score,overdue")).toEqual(["overdue", "score"]);
    expect(parseFollowUpSorts("owner,due,overdue")).toEqual(["overdue", "due", "owner"]);
  });

  it("drops unknown keys instead of failing the page", () => {
    expect(parseFollowUpSorts("overdue,dropTable,score")).toEqual(["overdue", "score"]);
    expect(parseFollowUpSorts("nonsense")).toEqual([]);
  });

  it("tolerates whitespace and duplicates", () => {
    expect(parseFollowUpSorts(" overdue , overdue , due ")).toEqual(["overdue", "due"]);
  });
});

describe("normalizeFollowUpScope", () => {
  it("defaults to scheduled follow-ups", () => {
    expect(normalizeFollowUpScope(undefined)).toBe("due");
    expect(normalizeFollowUpScope("bogus")).toBe("due");
  });

  it("accepts the two deliberate alternatives", () => {
    expect(normalizeFollowUpScope("missing")).toBe("missing");
    expect(normalizeFollowUpScope("all")).toBe("all");
  });
});

describe("buildReschedulePresets", () => {
  // 10 Aug 2026, 15:42 in Kolkata.
  const now = new Date("2026-08-10T10:12:00.000Z");

  it("resolves the dates in the org timezone, not the server's", () => {
    const kolkata = buildReschedulePresets(now, "Asia/Kolkata");
    const newYork = buildReschedulePresets(now, "America/New_York");
    expect(kolkata.map((preset) => preset.value)).toEqual([
      "2026-08-10T16:42",
      "2026-08-11T10:00",
      "2026-08-13T10:00",
      "2026-08-17T10:00",
    ]);
    // Same instant, still the small hours in New York, so "tomorrow" there is
    // the same calendar day it is already in Kolkata.
    expect(newYork[1]?.value).toBe("2026-08-11T10:00");
    expect(newYork[0]?.value).toBe("2026-08-10T07:12");
  });

  it("spells out every option so the raw value never has to be read", () => {
    for (const preset of buildReschedulePresets(now, "Asia/Kolkata")) {
      expect(preset.label).not.toBe("");
      expect(preset.hint).not.toBe("");
    }
  });
});
