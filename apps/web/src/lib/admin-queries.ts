import { apiKeys, conversionDestinations, getDb, projects, users } from "@monark/db";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { requirePermission } from "./auth";

export async function getSettingsOverview() {
  const actor = await requirePermission("settings:write");
  const db = getDb();

  const [userCount, projectCount, keyCount, destinations] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.orgId, actor.orgId), eq(users.isActive, true))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(projects)
      .where(and(eq(projects.orgId, actor.orgId), eq(projects.isActive, true))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(apiKeys)
      .where(and(eq(apiKeys.orgId, actor.orgId), isNull(apiKeys.revokedAt))),
    db
      .select({
        id: conversionDestinations.id,
        name: conversionDestinations.name,
        platform: conversionDestinations.platform,
        isEnabled: conversionDestinations.isEnabled,
        dryRun: conversionDestinations.dryRun,
      })
      .from(conversionDestinations)
      .where(eq(conversionDestinations.orgId, actor.orgId))
      .orderBy(asc(conversionDestinations.platform), asc(conversionDestinations.name)),
  ]);

  return {
    counts: {
      users: userCount[0]?.count ?? 0,
      projects: projectCount[0]?.count ?? 0,
      apiKeys: keyCount[0]?.count ?? 0,
    },
    destinations,
  };
}

export async function getAdminUsers() {
  const actor = await requirePermission("settings:write");
  const rows = await getDb()
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      phone: users.phone,
      role: users.role,
      languages: users.languages,
      leadCapacity: users.leadCapacity,
      isActive: users.isActive,
      lastSeenAt: users.lastSeenAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.orgId, actor.orgId))
    .orderBy(desc(users.isActive), asc(users.name), asc(users.email));

  return { currentUserId: actor.id, rows };
}

export async function getAdminProjects() {
  const actor = await requirePermission("settings:write");
  return getDb()
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      city: projects.city,
      reraNumber: projects.reraNumber,
      avgSaleValue: projects.avgSaleValue,
      isActive: projects.isActive,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(eq(projects.orgId, actor.orgId))
    .orderBy(desc(projects.isActive), asc(projects.name));
}

export async function getAdminApiData() {
  const actor = await requirePermission("settings:write");
  const db = getDb();
  const [keys, activeProjects] = await Promise.all([
    db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        scopes: apiKeys.scopes,
        projectId: apiKeys.projectId,
        projectName: projects.name,
        keyPolicy: apiKeys.keyPolicy,
        signatureRequired: apiKeys.signatureRequired,
        rateLimitPerMinute: apiKeys.rateLimitPerMinute,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .leftJoin(
        projects,
        and(eq(projects.id, apiKeys.projectId), eq(projects.orgId, actor.orgId)),
      )
      .where(eq(apiKeys.orgId, actor.orgId))
      .orderBy(desc(apiKeys.createdAt)),
    db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.orgId, actor.orgId), eq(projects.isActive, true)))
      .orderBy(asc(projects.name)),
  ]);

  return { keys, activeProjects };
}
