import { getDb } from "@monark/db";
import { sql } from "drizzle-orm";

export async function getSourceHealth(orgId: string) {
  const result = await getDb().execute(sql`
    SELECT t.source::text AS source,
           COUNT(DISTINCT t.id)::int AS touchpoints,
           COUNT(DISTINCT t.lead_id)::int AS leads,
           MAX(t.occurred_at) AS "lastReceivedAt",
           COUNT(DISTINCT t.lead_id) FILTER (WHERE EXISTS (
             SELECT 1 FROM visits v WHERE v.lead_id = t.lead_id AND v.arrived_at IS NOT NULL
           ))::int AS visits,
           COUNT(DISTINCT t.lead_id) FILTER (WHERE EXISTS (
             SELECT 1 FROM bookings b WHERE b.lead_id = t.lead_id AND b.status <> 'cancelled'
           ))::int AS bookings
    FROM lead_touchpoints t
    WHERE t.org_id = ${orgId}
    GROUP BY t.source
    ORDER BY COUNT(DISTINCT t.id) DESC, t.source
  `);
  return result.rows as unknown as {
    source: string;
    touchpoints: number;
    leads: number;
    lastReceivedAt: string | null;
    visits: number;
    bookings: number;
  }[];
}
