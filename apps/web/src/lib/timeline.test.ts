import { describe, expect, it } from "vitest";
import { groupTimeline, type TimelineEntry } from "./timeline";

const T = (offsetSeconds: number) => new Date(Date.UTC(2026, 7, 11, 10, 14, 0) + offsetSeconds * 1000);

/** The five rows a single public walk-in check-in actually writes. */
function checkInRows(): TimelineEntry[] {
  return [
    {
      at: T(0),
      kind: "touchpoint",
      groupKey: "lead-1",
      title: "Enquiry via walk in",
    },
    {
      at: T(0),
      kind: "stage",
      groupKey: "lead-1",
      title: "New → Visited",
      detail: "Checked in via Windwave Site",
    },
    {
      at: T(0),
      kind: "assignment",
      groupKey: "lead-1",
      title: "Assigned to Monark Sales",
      detail: "Routed by walk-in link: Windwave Site",
    },
    {
      at: T(0),
      kind: "activity",
      groupKey: "lead-1",
      title: "New visitor checked in · Windwave Site",
      detail: "Checked in at project site via Windwave Site\nConfigurations: 3Bhk",
    },
    {
      at: T(1),
      kind: "visit",
      groupKey: "lead-1",
      title: "Visited — project site",
      detail: "Configurations: 3Bhk",
    },
  ];
}

describe("grouping rows into moments", () => {
  it("collapses one check-in into a single event", () => {
    const moments = groupTimeline(checkInRows());

    expect(moments).toHaveLength(1);
    // The subject somebody wrote names the moment, not "Assigned to…".
    expect(moments[0]!.headline.title).toBe("New visitor checked in · Windwave Site");
  });

  it("keeps the routing note the team relies on", () => {
    const [moment] = groupTimeline(checkInRows());
    const assignment = moment!.facets.find((facet) => facet.kind === "assignment");

    expect(assignment?.title).toBe("Assigned to Monark Sales");
    expect(assignment?.detail).toBe("Routed by walk-in link: Windwave Site");
  });

  it("drops a facet line the headline already said", () => {
    const [moment] = groupTimeline(checkInRows());
    const visit = moment!.facets.find((facet) => facet.kind === "visit");

    // "Configurations: 3Bhk" is in the headline detail; repeating it under the
    // visit is exactly the noise this exists to remove.
    expect(visit?.detail).toBeNull();
    expect(visit?.title).toBe("Visited — project site");
  });

  it("loses nothing — every row still appears once", () => {
    const rows = checkInRows();
    const [moment] = groupTimeline(rows);
    const titles = [moment!.headline.title, ...moment!.facets.map((f) => f.title)];

    expect(new Set(titles)).toEqual(new Set(rows.map((row) => row.title)));
  });

  it("separates events that are genuinely minutes apart", () => {
    const later: TimelineEntry = {
      at: T(37 * 60),
      kind: "stage",
      groupKey: "lead-1",
      title: "Visited → New",
      detail: "Returned to New: a self-service site check-in is not a worked lead",
    };
    const moments = groupTimeline([...checkInRows(), later]);

    expect(moments).toHaveLength(2);
    expect(moments[0]!.headline.title).toBe("Visited → New");
    expect(moments[1]!.headline.title).toBe("New visitor checked in · Windwave Site");
  });

  it("never merges across two different enquiries", () => {
    // Both detail pages fold in a person's other opportunities. Two enquiries
    // touched in the same minute are two moments, however close together.
    const moments = groupTimeline([
      { at: T(0), kind: "activity", groupKey: "lead-1", title: "Called about Windwave" },
      { at: T(2), kind: "activity", groupKey: "lead-2", title: "Called about Skyline" },
    ]);

    expect(moments).toHaveLength(2);
  });

  it("returns newest first and ignores unparseable timestamps", () => {
    const moments = groupTimeline([
      { at: T(0), kind: "activity", groupKey: "a", title: "older" },
      { at: T(600), kind: "activity", groupKey: "b", title: "newer" },
      { at: new Date("nonsense"), kind: "activity", groupKey: "c", title: "broken" },
    ]);

    expect(moments.map((moment) => moment.headline.title)).toEqual(["newer", "older"]);
  });

  it("handles an empty log", () => {
    expect(groupTimeline([])).toEqual([]);
  });
});
