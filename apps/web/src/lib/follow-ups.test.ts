import { describe, expect, it } from "vitest";
import {
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
