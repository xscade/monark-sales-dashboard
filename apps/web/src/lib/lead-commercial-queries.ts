import { getDb } from "@monark/db";
import { sql } from "drizzle-orm";

export async function getLeadCommercialPanel(orgId: string, leadId: string) {
  const [leadResult, shortlistResult, availableResult, offerResult] = await Promise.all([
    getDb().execute(sql`
      SELECT l.id, l.project_id AS "projectId", pr.name AS "projectName"
      FROM leads l LEFT JOIN projects pr ON pr.id = l.project_id AND pr.org_id = l.org_id
      WHERE l.org_id = ${orgId} AND l.id = ${leadId} LIMIT 1
    `),
    getDb().execute(sql`
      SELECT ui.id, ui.unit_id AS "unitId", ui.rank, ui.notes,
             u.unit_number AS "unitNumber", u.tower, u.configuration,
             u.all_in_price AS "allInPrice", u.status::text AS status
      FROM unit_interests ui
      JOIN units u ON u.id = ui.unit_id AND u.org_id = ui.org_id
      WHERE ui.org_id = ${orgId} AND ui.lead_id = ${leadId}
      ORDER BY ui.rank NULLS LAST, ui.created_at
    `),
    getDb().execute(sql`
      SELECT u.id, u.unit_number AS "unitNumber", u.tower, u.configuration,
             u.all_in_price AS "allInPrice", u.status::text AS status
      FROM units u
      JOIN leads l ON l.project_id = u.project_id AND l.org_id = u.org_id
      WHERE l.org_id = ${orgId} AND l.id = ${leadId}
        AND u.status IN ('available','held')
        AND NOT EXISTS (SELECT 1 FROM unit_interests ui WHERE ui.lead_id = l.id AND ui.unit_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.unit_id = u.id AND b.status <> 'cancelled')
      ORDER BY u.tower NULLS FIRST, u.floor NULLS FIRST, u.unit_number
      LIMIT 200
    `),
    getDb().execute(sql`
      SELECT a.id, a.subject, a.body, a.metadata, a.occurred_at AS "occurredAt",
             usr.name AS "userName"
      FROM activities a LEFT JOIN users usr ON usr.id = a.user_id
      WHERE a.org_id = ${orgId} AND a.lead_id = ${leadId}
        AND a.metadata->>'kind' = 'negotiation_offer'
      ORDER BY a.occurred_at DESC LIMIT 100
    `),
  ]);

  const lead = (leadResult.rows as unknown as { id: string; projectId: string | null; projectName: string | null }[])[0];
  if (!lead) return null;
  return {
    lead,
    shortlist: shortlistResult.rows as unknown as { id: string; unitId: string; rank: number | null; notes: string | null; unitNumber: string; tower: string | null; configuration: string; allInPrice: string | null; status: string }[],
    available: availableResult.rows as unknown as { id: string; unitNumber: string; tower: string | null; configuration: string; allInPrice: string | null; status: string }[],
    offers: offerResult.rows as unknown as { id: string; subject: string | null; body: string | null; metadata: Record<string, unknown> | null; occurredAt: string; userName: string | null }[],
  };
}
