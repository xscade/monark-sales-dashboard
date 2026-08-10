import { conversionDestinations, conversionEventMappings, getDb, projects } from "@monark/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { requirePermission } from "./auth";

export async function getIntegrationSettings() {
  const actor = await requirePermission("settings:write");
  const db = getDb();
  const [destinations, mappings, activeProjects] = await Promise.all([
    db.select({
      id: conversionDestinations.id, platform: conversionDestinations.platform,
      name: conversionDestinations.name, projectId: conversionDestinations.projectId,
      isEnabled: conversionDestinations.isEnabled, dryRun: conversionDestinations.dryRun,
      config: conversionDestinations.config,
      hasCredentials: sql<boolean>`${conversionDestinations.credentialsEncrypted} IS NOT NULL`,
    }).from(conversionDestinations)
      .where(eq(conversionDestinations.orgId, actor.orgId))
      .orderBy(asc(conversionDestinations.platform), asc(conversionDestinations.name)),
    db.select({
      id: conversionEventMappings.id, destinationId: conversionEventMappings.destinationId,
      eventType: conversionEventMappings.eventType, isEnabled: conversionEventMappings.isEnabled,
      platformEventName: conversionEventMappings.platformEventName,
      platformDestinationId: conversionEventMappings.platformDestinationId,
      valueStrategy: conversionEventMappings.valueStrategy, fixedValue: conversionEventMappings.fixedValue,
    }).from(conversionEventMappings)
      .innerJoin(conversionDestinations, and(
        eq(conversionDestinations.id, conversionEventMappings.destinationId),
        eq(conversionDestinations.orgId, actor.orgId),
      ))
      .where(eq(conversionEventMappings.orgId, actor.orgId))
      .orderBy(asc(conversionEventMappings.eventType)),
    db.select({ id: projects.id, name: projects.name }).from(projects)
      .where(and(eq(projects.orgId, actor.orgId), eq(projects.isActive, true)))
      .orderBy(asc(projects.name)),
  ]);
  return { destinations, mappings, activeProjects };
}
