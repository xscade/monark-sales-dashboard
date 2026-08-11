import { describe, expect, it } from "vitest";
import { isNoteworthyStageChange, sortTimeline, type TimelineEntry } from "./timeline";

const T = (offsetSeconds: number) =>
  new Date(Date.UTC(2026, 7, 11, 10, 14, 0) + offsetSeconds * 1000);

describe("which stage changes reach the log", () => {
  it("keeps a change a person made and explained", () => {
    // The reason someone typed is often the only record of why a deal moved.
    expect(
      isNoteworthyStageChange({
        changed_by: "user",
        changed_by_user_id: "user-1",
        reason: "Budget fell through",
      }),
    ).toBe(true);
  });

  it("drops the automatic hop a self-service check-in writes", () => {
    // This restates the check-in activity sitting right next to it.
    expect(
      isNoteworthyStageChange({
        changed_by: "api",
        changed_by_user_id: null,
        reason: "Checked in via Windwave Site",
      }),
    ).toBe(false);
  });

  it("drops a correction applied by a migration", () => {
    expect(
      isNoteworthyStageChange({
        changed_by: "system",
        changed_by_user_id: null,
        reason: "Returned to New: a self-service site check-in is not a worked lead",
      }),
    ).toBe(false);
  });

  it("drops a human change with no reason given", () => {
    // A bare "Contacted → Qualified" adds nothing the stage badge does not.
    expect(
      isNoteworthyStageChange({ changed_by: "user", changed_by_user_id: "user-1", reason: "  " }),
    ).toBe(false);
  });
});

describe("ordering the log", () => {
  const entries: TimelineEntry[] = [
    { at: T(0), kind: "activity", title: "older" },
    { at: T(600), kind: "visit", title: "newer" },
    { at: new Date("nonsense"), kind: "stage", title: "unparseable" },
  ];

  it("returns newest first", () => {
    expect(sortTimeline(entries).map((entry) => entry.title)).toEqual(["newer", "older"]);
  });

  it("drops rows with an unusable timestamp rather than rendering them", () => {
    expect(sortTimeline(entries).some((entry) => entry.title === "unparseable")).toBe(false);
  });

  it("handles an empty log", () => {
    expect(sortTimeline([])).toEqual([]);
  });
});
