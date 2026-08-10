import { getDb, projects, users } from "@monark/db";
import { and, asc, eq, inArray } from "drizzle-orm";

export async function getLeadFormOptions(orgId: string) {
  const db = getDb();
  const [projectRows, agentRows] = await Promise.all([
    db
      .select({ id: projects.id, name: projects.name, city: projects.city })
      .from(projects)
      .where(and(eq(projects.orgId, orgId), eq(projects.isActive, true)))
      .orderBy(asc(projects.name)),
    db
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(
        and(
          eq(users.orgId, orgId),
          eq(users.isActive, true),
          inArray(users.role, ["owner", "admin", "sales_manager", "sales_agent"]),
        ),
      )
      .orderBy(asc(users.name)),
  ]);

  return { projects: projectRows, agents: agentRows };
}
