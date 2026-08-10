import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getDb: vi.fn(),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  and: vi.fn((...conditions: unknown[]) => conditions),
}));

vi.mock("react", () => ({
  // React's cache is request-scoped. An identity wrapper keeps each unit test
  // independent while exercising the same access decision branches.
  cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

vi.mock("next/navigation", () => ({
  redirect: (destination: string) => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  },
}));

vi.mock("./supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
  })),
}));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  eq: mocks.eq,
}));

vi.mock("@monark/db", () => ({
  getDb: mocks.getDb,
  users: {
    id: "users.id",
    orgId: "users.org_id",
    email: "users.email",
    name: "users.name",
    role: "users.role",
    isActive: "users.is_active",
  },
  orgs: {
    id: "orgs.id",
    name: "orgs.name",
    timezone: "orgs.timezone",
  },
}));

import { requireUser } from "./auth";

function mockCrmRows(rows: unknown[]) {
  const limit = vi.fn(async () => rows);
  const where = vi.fn(() => ({ limit }));
  const innerJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ innerJoin }));
  const select = vi.fn(() => ({ from }));

  mocks.getDb.mockReturnValue({ select });

  return { select, from, innerJoin, where, limit };
}

describe("requireUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCrmRows([]);
  });

  it("sends a visitor without a Supabase session to login", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("sends a signed-in visitor without an active CRM user to no-access", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "auth-user", email: "missing@example.com" } },
    });

    await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT:/no-access");
    expect(mocks.getDb).toHaveBeenCalledOnce();
  });

  it("returns the active CRM user for a signed-in visitor", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "auth-user", email: "SALES@MONARKREALCON.COM" } },
    });
    const row = {
      id: "crm-user",
      orgId: "monark-org",
      orgName: "Monark",
      timezone: "Asia/Kolkata",
      email: "sales@monarkrealcon.com",
      name: "Monark Sales",
      role: "owner" as const,
    };
    mockCrmRows([row]);

    await expect(requireUser()).resolves.toEqual(row);
    expect(mocks.eq).toHaveBeenCalledWith("users.email", "sales@monarkrealcon.com");
    expect(mocks.eq).toHaveBeenCalledWith("users.is_active", true);
  });
});
