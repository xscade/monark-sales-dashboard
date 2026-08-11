import { describe, expect, it } from "vitest";
import {
  ACCESS_MODULES,
  effectiveGrants,
  grantsFromTokens,
  grantsToTokens,
  normalizeGrants,
  permissionsFromGrants,
  ROLE_DEFAULT_GRANTS,
  USER_ROLES,
  type Permission,
  type UserRole,
} from "./permissions";

function permissionsFor(role: UserRole): Set<Permission> {
  return permissionsFromGrants(effectiveGrants(role, null));
}

/**
 * The role table this app shipped with, transposed.
 *
 * Roles are now expressed as module grids, which is a genuinely different
 * representation — so this pins the *outcome* rather than the shape. Anything
 * that quietly widens a role shows up here as a failure, which is the whole
 * point: nobody notices a sales agent gaining API-key access by reading a diff.
 */
const LEGACY_ROLE_PERMISSIONS: Record<Permission, UserRole[]> = {
  "leads:read": ["owner", "admin", "marketing", "sales_manager", "sales_agent", "receptionist", "read_only"],
  "leads:write": ["owner", "admin", "sales_manager", "sales_agent", "receptionist"],
  "leads:assign": ["owner", "admin", "sales_manager"],
  "customers:read": ["owner", "admin", "marketing", "sales_manager", "sales_agent", "receptionist", "read_only"],
  "customers:write": ["owner", "admin", "sales_manager", "sales_agent", "receptionist"],
  "tasks:read": ["owner", "admin", "marketing", "sales_manager", "sales_agent", "receptionist", "read_only"],
  "tasks:write": ["owner", "admin", "sales_manager", "sales_agent", "receptionist"],
  "visits:read": ["owner", "admin", "marketing", "sales_manager", "sales_agent", "receptionist", "read_only"],
  "visits:write": ["owner", "admin", "sales_manager", "sales_agent", "receptionist"],
  "inventory:read": ["owner", "admin", "marketing", "sales_manager", "sales_agent", "receptionist", "read_only"],
  "inventory:write": ["owner", "admin", "sales_manager"],
  "bookings:read": ["owner", "admin", "marketing", "sales_manager", "sales_agent", "receptionist", "read_only"],
  "bookings:write": ["owner", "admin", "sales_manager"],
  "campaigns:read": ["owner", "admin", "marketing", "sales_manager"],
  "campaigns:write": ["owner", "admin", "marketing"],
  "conversions:read": ["owner", "admin", "marketing"],
  "conversions:write": ["owner", "admin", "marketing"],
  "reports:read": ["owner", "admin", "marketing", "sales_manager", "read_only"],
  "settings:write": ["owner", "admin"],
} as Record<Permission, UserRole[]>;

describe("role defaults", () => {
  it("reproduces the permissions each role had before grants existed", () => {
    for (const [permission, roles] of Object.entries(LEGACY_ROLE_PERMISSIONS)) {
      for (const role of USER_ROLES) {
        expect(
          { permission, role, allowed: permissionsFor(role).has(permission as Permission) },
        ).toEqual({ permission, role, allowed: roles.includes(role) });
      }
    }
  });

  it("keeps the accounts queue out of every role by default", () => {
    for (const role of USER_ROLES) {
      const allowed = permissionsFor(role).has("accounts:verify");
      expect({ role, allowed }).toEqual({ role, allowed: role === "owner" || role === "admin" });
    }
  });
});

describe("effective grants", () => {
  it("prefers a stored grid over the role, including an empty one", () => {
    const restricted = effectiveGrants("sales_manager", { reports: ["read"] });
    expect(restricted).toEqual({ reports: ["read"] });
    expect(permissionsFromGrants(restricted).has("bookings:write")).toBe(false);

    // Empty is an answer, not a missing value.
    expect(effectiveGrants("sales_manager", {})).toEqual({});
  });

  it("never restricts an owner, however the grid was saved", () => {
    const grants = effectiveGrants("owner", {});
    expect(permissionsFromGrants(grants).has("settings:write")).toBe(true);
  });

  it("layers the accountant role type over whatever the base access is", () => {
    const grants = effectiveGrants("read_only", null, "accountant");
    const permissions = permissionsFromGrants(grants);

    expect(permissions.has("accounts:read")).toBe(true);
    expect(permissions.has("accounts:verify")).toBe(true);
    expect(permissions.has("reports:read")).toBe(true);
    // Confirming that money arrived must not come with the ability to edit the
    // amount being confirmed.
    expect(permissions.has("bookings:write")).toBe(false);
  });

  it("gives an accountant the queue even when the grid revokes everything", () => {
    const permissions = permissionsFromGrants(effectiveGrants("sales_agent", {}, "accountant"));
    expect(permissions.has("accounts:verify")).toBe(true);
  });
});

describe("grant derivation", () => {
  it("expands create, update and delete into the write umbrella", () => {
    const permissions = permissionsFromGrants({ inventory: ["delete"] });
    expect(permissions.has("inventory:delete")).toBe(true);
    expect(permissions.has("inventory:write")).toBe(true);
    expect(permissions.has("inventory:read")).toBe(false);
  });

  it("keeps lead reassignment a supervisory right, not an edit", () => {
    expect(permissionsFromGrants({ leads: ["delete"] }).has("leads:assign")).toBe(true);
    expect(permissionsFromGrants({ leads: ["read", "create", "update"] }).has("leads:assign")).toBe(
      false,
    );
  });

  it("discards unknown modules and unsupported actions", () => {
    expect(
      normalizeGrants({ reports: ["read", "delete"], nonsense: ["read"], leads: "all" }),
    ).toEqual({ reports: ["read"] });
    expect(normalizeGrants(null)).toEqual({});
    expect(normalizeGrants(["reports:read"])).toEqual({});
  });

  it("round-trips a grid through checkbox tokens", () => {
    const grid = ROLE_DEFAULT_GRANTS.sales_manager;
    expect(grantsFromTokens(grantsToTokens(grid))).toEqual(grid);
    expect(grantsFromTokens(["bookings:read", "junk", "bookings:teleport"])).toEqual({
      bookings: ["read"],
    });
  });
});

describe("module registry", () => {
  it("maps every module to a distinct permission namespace", () => {
    const namespaces = ACCESS_MODULES.map((module) => module.namespace);
    expect(new Set(namespaces).size).toBe(namespaces.length);
  });

  it("only offers actions a module actually supports", () => {
    // A decorative Delete checkbox that grants write access is worse than no
    // checkbox at all.
    for (const module of ACCESS_MODULES) {
      expect(module.actions.length).toBeGreaterThan(0);
      for (const action of Object.keys(module.actionLabels ?? {})) {
        expect(module.actions).toContain(action);
      }
      for (const action of Object.keys(module.extra ?? {})) {
        expect(module.actions).toContain(action);
      }
    }
  });
});
