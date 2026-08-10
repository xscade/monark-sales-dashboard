import { getDb } from "@monark/db";
import { sql } from "drizzle-orm";

export type VisitStatus = "scheduled" | "confirmed" | "arrived" | "completed" | "no_show" | "cancelled";

export async function listVisits(
  orgId: string,
  filters: { status?: VisitStatus; range?: "today" | "upcoming" | "past"; userId?: string } = {},
) {
  const conditions = [sql`v.org_id = ${orgId}`];
  if (filters.userId) {
    conditions.push(sql`(l.owner_user_id = ${filters.userId} OR v.host_user_id = ${filters.userId})`);
  }
  if (filters.status) conditions.push(sql`v.status = ${filters.status}::visit_status`);
  if (filters.range === "today") {
    conditions.push(sql`(v.scheduled_at AT TIME ZONE o.timezone)::date = (now() AT TIME ZONE o.timezone)::date`);
  } else if (filters.range === "upcoming") {
    conditions.push(sql`(v.status = 'arrived' OR (v.scheduled_at >= now() AND v.status IN ('scheduled','confirmed')))`);
  } else if (filters.range === "past") {
    conditions.push(sql`COALESCE(v.arrived_at, v.scheduled_at) < now()`);
  }

  const result = await getDb().execute(sql`
    SELECT
      v.id, v.type::text AS type, v.status::text AS status,
      v.scheduled_at AS "scheduledAt", v.arrived_at AS "arrivedAt",
      v.departed_at AS "departedAt", v.accompanying_count AS "accompanyingCount",
      v.accompanying_relations AS "accompanyingRelations",
      v.intent_rating AS "intentRating", v.configurations_viewed AS "configurationsViewed",
      v.units_viewed AS "unitsViewed", v.objections, v.notes, v.next_action AS "nextAction",
      l.id AS "leadId", l.reference AS "leadReference", l.stage::text AS "leadStage",
      p.full_name AS "customerName", p.primary_phone AS "phone",
      pr.name AS "projectName", host.name AS "hostName",
      o.timezone
    FROM visits v
    JOIN orgs o ON o.id = v.org_id
    JOIN leads l ON l.id = v.lead_id
    JOIN persons p ON p.id = v.person_id
    LEFT JOIN projects pr ON pr.id = v.project_id
    LEFT JOIN users host ON host.id = v.host_user_id
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY
      CASE WHEN v.status IN ('scheduled','confirmed') AND v.scheduled_at >= now() THEN 0 ELSE 1 END,
      CASE WHEN v.status IN ('scheduled','confirmed') AND v.scheduled_at >= now() THEN v.scheduled_at END ASC,
      COALESCE(v.arrived_at, v.scheduled_at, v.created_at) DESC
    LIMIT 300
  `);
  return result.rows as unknown as {
    id: string;
    type: string;
    status: VisitStatus;
    scheduledAt: string | null;
    arrivedAt: string | null;
    departedAt: string | null;
    accompanyingCount: number;
    accompanyingRelations: string[] | null;
    intentRating: number | null;
    configurationsViewed: string[] | null;
    unitsViewed: string[] | null;
    objections: string[] | null;
    notes: string | null;
    nextAction: string | null;
    leadId: string;
    leadReference: string;
    leadStage: string;
    customerName: string | null;
    phone: string | null;
    projectName: string | null;
    hostName: string | null;
    timezone: string;
  }[];
}

export async function getVisitSchedulingOptions(orgId: string, userId?: string) {
  const [leadsResult, usersResult] = await Promise.all([
    getDb().execute(sql`
      SELECT l.id, l.reference, l.project_id AS "projectId", p.full_name AS name,
             p.primary_phone AS phone, pr.name AS "projectName"
      FROM leads l
      JOIN persons p ON p.id = l.person_id
      LEFT JOIN projects pr ON pr.id = l.project_id
      WHERE l.org_id = ${orgId} AND l.is_test = false
        AND l.project_id IS NOT NULL
        AND l.stage NOT IN ('booked','lost','disqualified')
        ${userId ? sql`AND l.owner_user_id = ${userId}` : sql``}
      ORDER BY l.last_activity_at DESC NULLS LAST, l.created_at DESC
      LIMIT 300
    `),
    getDb().execute(sql`
      SELECT id, name, role::text AS role FROM users
      WHERE org_id = ${orgId} AND is_active = true
        AND role IN ('owner','admin','sales_manager','sales_agent')
        ${userId ? sql`AND id = ${userId}` : sql``}
      ORDER BY name
    `),
  ]);
  return {
    leads: leadsResult.rows as unknown as { id: string; reference: string; projectId: string | null; name: string | null; phone: string | null; projectName: string | null }[],
    hosts: usersResult.rows as unknown as { id: string; name: string; role: string }[],
  };
}
