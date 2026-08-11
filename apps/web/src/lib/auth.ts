import { getDb, users, orgs } from "@monark/db";
import type { User } from "@supabase/supabase-js";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import {
  effectiveGrants,
  normalizeGrants,
  permissionsFromGrants,
  ROLE_TYPES,
  type AccessGrants,
  type Permission,
  type RoleType,
  type UserRole,
} from "./permissions";
import { createClient } from "./supabase/server";

export type { Permission } from "./permissions";

export interface SessionUser {
  id: string;
  orgId: string;
  orgName: string;
  timezone: string;
  email: string;
  name: string;
  role: UserRole;
  /** Back-office specialisation; `accountant` unlocks the verification queue. */
  roleType: RoleType | null;
  /** Per-module overrides an admin set explicitly. `null` means the role
   *  defaults apply — see `effectiveGrants`. */
  permissions: AccessGrants | null;
}

/**
 * Verify the Supabase identity once per server render.
 *
 * Both the layout and its page call `requireUser`, and resolving the CRM user
 * also needs the Auth identity. Keeping this request-scoped avoids turning one
 * page view into several calls to Supabase Auth.
 */
export const getAuthUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
});

/**
 * Resolve the signed-in Supabase identity to a Monark user.
 *
 * Two separate things are being checked, and conflating them would be a real
 * hole: Supabase Auth proves *who* someone is, but our `users` table decides
 * whether they may see this CRM at all. Anyone can end up with a Supabase
 * account on this project — having one must not, by itself, grant access to
 * every buyer's phone number and budget.
 *
 * So: no matching active `users` row means no access, regardless of how valid
 * the Supabase session is.
 *
 * Wrapped in React `cache` so the several components that need the current user
 * during one render share a single query.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const user = await getAuthUser();

  if (!user?.email) return null;

  const db = getDb();
  const [row] = await db
    .select({
      id: users.id,
      orgId: users.orgId,
      email: users.email,
      name: users.name,
      role: users.role,
      roleType: users.roleType,
      permissions: users.permissions,
      orgName: orgs.name,
      timezone: orgs.timezone,
    })
    .from(users)
    .innerJoin(orgs, eq(orgs.id, users.orgId))
    .where(and(eq(users.email, user.email.toLowerCase()), eq(users.isActive, true)))
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    orgId: row.orgId,
    orgName: row.orgName,
    timezone: row.timezone,
    email: row.email,
    name: row.name,
    role: row.role,
    roleType: ROLE_TYPES.includes(row.roleType as RoleType) ? (row.roleType as RoleType) : null,
    // A grid stored before a module was renamed or retired would otherwise hand
    // out permissions for a module that no longer exists.
    permissions: row.permissions ? normalizeGrants(row.permissions) : null,
  };
});

/**
 * Use in every authenticated page. Redirects rather than throwing.
 *
 * The destination matters. Sending a signed-in-but-unauthorised visitor to
 * /login creates an infinite redirect loop: the middleware bounces anyone with
 * a Supabase session away from /login and back here, and here sends them
 * straight back. Two different definitions of "authenticated" pointing at each
 * other.
 *
 * /no-access breaks the cycle — it renders for anyone holding a session and
 * offers a way out.
 */
export async function requireUser(): Promise<SessionUser> {
  const authUser = await getAuthUser();

  // No session at all: the login page is the right place.
  if (!authUser) redirect("/login");

  const user = await getCurrentUser();
  // Valid Supabase identity, but no active row in our users table.
  if (!user) redirect("/no-access");

  return user;
}

/**
 * Access gate.
 *
 * Sales agents must not see campaign spend or be able to rotate API keys;
 * marketing has no business editing bookings. The rules themselves live in
 * `permissions.ts` as a module grid — the same grid an admin edits in
 * Settings → Users — so there is exactly one description of who may do what,
 * whether it came from a role or from an explicit grant.
 */
export function can(user: SessionUser, permission: Permission): boolean {
  const granted = effectiveGrants(user.role, user.permissions, user.roleType);
  return permissionsFromGrants(granted).has(permission);
}

export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user, permission)) redirect("/");
  return user;
}
