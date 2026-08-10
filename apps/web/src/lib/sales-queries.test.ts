import { describe, expect, it } from "vitest";
import { canManageSalesTeam, normalizeTaskStatus, resolveSalesOwnerFilter } from "./sales-queries";

const CURRENT_USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";

describe("resolveSalesOwnerFilter", () => {
  it("cannot be overridden for an individual contributor", () => {
    expect(resolveSalesOwnerFilter("sales_agent", CURRENT_USER, OTHER_USER)).toBe(CURRENT_USER);
    expect(resolveSalesOwnerFilter("sales_agent", CURRENT_USER)).toBe(CURRENT_USER);
  });

  it("lets organisation-wide roles select an agent or view the whole team", () => {
    expect(resolveSalesOwnerFilter("sales_manager", CURRENT_USER, OTHER_USER)).toBe(OTHER_USER);
    expect(resolveSalesOwnerFilter("admin", CURRENT_USER)).toBeUndefined();
    expect(resolveSalesOwnerFilter("owner", CURRENT_USER, "not-a-user-id")).toBeUndefined();
    expect(resolveSalesOwnerFilter("marketing", CURRENT_USER)).toBeUndefined();
    expect(resolveSalesOwnerFilter("receptionist", CURRENT_USER, OTHER_USER)).toBe(OTHER_USER);
    expect(resolveSalesOwnerFilter("read_only", CURRENT_USER)).toBeUndefined();
  });
});

describe("normalizeTaskStatus", () => {
  it("accepts supported task tabs", () => {
    expect(normalizeTaskStatus("overdue")).toBe("overdue");
    expect(normalizeTaskStatus("today")).toBe("today");
    expect(normalizeTaskStatus("upcoming")).toBe("upcoming");
    expect(normalizeTaskStatus("completed")).toBe("completed");
  });

  it("falls back to the open queue", () => {
    expect(normalizeTaskStatus()).toBe("open");
    expect(normalizeTaskStatus("everything")).toBe("open");
  });
});

describe("canManageSalesTeam", () => {
  it("separates team visibility from mutation authority", () => {
    expect(canManageSalesTeam("sales_manager")).toBe(true);
    expect(canManageSalesTeam("receptionist")).toBe(false);
    expect(canManageSalesTeam("marketing")).toBe(false);
  });
});
