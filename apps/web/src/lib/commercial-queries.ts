import { getDb } from "@monark/db";
import { sql } from "drizzle-orm";

const db = () => getDb();

export interface CommercialProject {
  id: string;
  name: string;
  city: string | null;
}

export interface CommercialLeadOption {
  id: string;
  reference: string;
  fullName: string | null;
  primaryPhone: string | null;
  projectId: string | null;
  projectName: string | null;
  stage: string;
}

export interface InventoryFilters {
  projectId?: string;
  status?: string;
  configuration?: string;
  search?: string;
}

export interface InventoryRow {
  id: string;
  projectId: string;
  projectName: string;
  tower: string | null;
  unitNumber: string;
  floor: number | null;
  configuration: string;
  carpetAreaSqft: string | null;
  saleableAreaSqft: string | null;
  facing: string | null;
  basePrice: string | null;
  allInPrice: string | null;
  status: string;
  holdId: string | null;
  holdExpiresAt: string | null;
  heldForLeadId: string | null;
  heldForLeadReference: string | null;
  heldForName: string | null;
}

export interface BookingFilters {
  projectId?: string;
  status?: string;
  search?: string;
}

export interface BookingRow {
  id: string;
  reference: string;
  status: string;
  leadId: string;
  leadReference: string;
  personName: string | null;
  primaryPhone: string | null;
  projectName: string | null;
  unitLabel: string | null;
  agreementValue: string | null;
  tokenAmount: string | null;
  collectedAmount: string;
  tokenPaidAt: string | null;
  bookedAt: string | null;
  createdAt: string;
}

export interface BookingPaymentRow {
  id: string;
  amount: string;
  kind: string;
  mode: string | null;
  reference: string | null;
  receivedAt: string;
  isReversed: boolean;
  recordedByName: string | null;
}

export interface BookingDetail extends BookingRow {
  personId: string;
  projectId: string | null;
  unitId: string | null;
  closedByName: string | null;
  agreementSignedAt: string | null;
  registeredAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  payments: BookingPaymentRow[];
}

export async function listCommercialProjects(orgId: string): Promise<CommercialProject[]> {
  const result = await db().execute(sql`
    SELECT id, name, city
    FROM projects
    WHERE org_id = ${orgId} AND is_active = true
    ORDER BY name
  `);
  return result.rows as unknown as CommercialProject[];
}

export async function listCommercialLeads(
  orgId: string,
  projectId?: string,
): Promise<CommercialLeadOption[]> {
  const result = await db().execute(sql`
    SELECT l.id, l.reference, l.project_id AS "projectId", l.stage::text AS stage,
           p.full_name AS "fullName", p.primary_phone AS "primaryPhone",
           pr.name AS "projectName"
    FROM leads l
    JOIN persons p ON p.id = l.person_id
    LEFT JOIN projects pr ON pr.id = l.project_id
    WHERE l.org_id = ${orgId}
      AND l.is_test = false
      AND l.stage NOT IN ('booked', 'lost', 'disqualified')
      AND NOT EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.org_id = l.org_id AND b.lead_id = l.id AND b.status <> 'cancelled'
      )
      AND (${projectId ?? null}::uuid IS NULL OR l.project_id = ${projectId ?? null}::uuid)
    ORDER BY l.updated_at DESC
    LIMIT 300
  `);
  return result.rows as unknown as CommercialLeadOption[];
}

export async function listInventory(
  orgId: string,
  filters: InventoryFilters = {},
): Promise<InventoryRow[]> {
  const commercialStatus = sql`
    CASE
      WHEN b.status = 'token' THEN 'token_paid'
      WHEN b.status IN ('booked', 'agreement_signed') THEN 'booked'
      WHEN b.status = 'registered' THEN 'registered'
      WHEN h.id IS NOT NULL THEN 'held'
      WHEN u.status = 'held' THEN 'available'
      WHEN u.status IN ('token_paid', 'booked', 'registered') THEN 'blocked'
      ELSE u.status::text
    END
  `;
  const conditions = [sql`u.org_id = ${orgId}`];
  if (filters.projectId) conditions.push(sql`u.project_id = ${filters.projectId}`);
  if (filters.status) conditions.push(sql`${commercialStatus} = ${filters.status}`);
  if (filters.configuration) conditions.push(sql`u.configuration = ${filters.configuration}`);
  if (filters.search) {
    const term = `%${filters.search.replace(/[%_]/g, "").trim()}%`;
    conditions.push(sql`(
      u.unit_number ILIKE ${term}
      OR COALESCE(u.tower, '') ILIKE ${term}
      OR pr.name ILIKE ${term}
      OR COALESCE(h.lead_reference, '') ILIKE ${term}
      OR COALESCE(h.held_for_name, '') ILIKE ${term}
    )`);
  }

  const result = await db().execute(sql`
    SELECT u.id, u.project_id AS "projectId", pr.name AS "projectName",
           u.tower, u.unit_number AS "unitNumber", u.floor, u.configuration,
           u.carpet_area_sqft AS "carpetAreaSqft",
           u.saleable_area_sqft AS "saleableAreaSqft", u.facing,
           u.base_price AS "basePrice", u.all_in_price AS "allInPrice",
           ${commercialStatus} AS status,
           h.id AS "holdId", h.expires_at AS "holdExpiresAt",
           h.lead_id AS "heldForLeadId", h.lead_reference AS "heldForLeadReference",
           h.held_for_name AS "heldForName"
    FROM units u
    JOIN projects pr ON pr.id = u.project_id AND pr.org_id = u.org_id
    LEFT JOIN LATERAL (
      SELECT uh.id, uh.expires_at, uh.lead_id, l.reference AS lead_reference,
             p.full_name AS held_for_name
      FROM unit_holds uh
      JOIN leads l ON l.id = uh.lead_id AND l.org_id = uh.org_id
      JOIN persons p ON p.id = l.person_id AND p.org_id = uh.org_id
      WHERE uh.org_id = u.org_id AND uh.unit_id = u.id
        AND uh.released_at IS NULL AND uh.expires_at > now()
      ORDER BY uh.created_at DESC
      LIMIT 1
    ) h ON true
    LEFT JOIN LATERAL (
      SELECT bk.status
      FROM bookings bk
      WHERE bk.org_id = u.org_id AND bk.unit_id = u.id AND bk.status <> 'cancelled'
      ORDER BY bk.created_at DESC
      LIMIT 1
    ) b ON true
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY pr.name, u.tower NULLS FIRST, u.floor NULLS FIRST, u.unit_number
    LIMIT 500
  `);

  return result.rows as unknown as InventoryRow[];
}

export async function listBookableUnits(orgId: string): Promise<InventoryRow[]> {
  const rows = await listInventory(orgId);
  return rows.filter((row) => row.status === "available" || row.status === "held");
}

export async function listBookings(
  orgId: string,
  filters: BookingFilters = {},
): Promise<BookingRow[]> {
  const conditions = [sql`b.org_id = ${orgId}`];
  if (filters.projectId) conditions.push(sql`b.project_id = ${filters.projectId}`);
  if (filters.status) conditions.push(sql`b.status = ${filters.status}`);
  if (filters.search) {
    const term = `%${filters.search.replace(/[%_]/g, "").trim()}%`;
    conditions.push(sql`(
      b.reference ILIKE ${term}
      OR l.reference ILIKE ${term}
      OR COALESCE(p.full_name, '') ILIKE ${term}
      OR COALESCE(p.primary_phone, '') ILIKE ${term}
      OR COALESCE(u.unit_number, '') ILIKE ${term}
    )`);
  }

  const result = await db().execute(sql`
    SELECT b.id, b.reference, b.status, b.lead_id AS "leadId",
           l.reference AS "leadReference", p.full_name AS "personName",
           p.primary_phone AS "primaryPhone", pr.name AS "projectName",
           CASE WHEN u.id IS NULL THEN NULL
                ELSE CONCAT_WS(' · ', NULLIF(u.tower, ''), u.unit_number) END AS "unitLabel",
           b.agreement_value AS "agreementValue", b.token_amount AS "tokenAmount",
           COALESCE(pay.collected, 0)::text AS "collectedAmount",
           b.token_paid_at AS "tokenPaidAt", b.booked_at AS "bookedAt",
           b.created_at AS "createdAt"
    FROM bookings b
    JOIN leads l ON l.id = b.lead_id AND l.org_id = b.org_id
    JOIN persons p ON p.id = b.person_id AND p.org_id = b.org_id
    LEFT JOIN projects pr ON pr.id = b.project_id AND pr.org_id = b.org_id
    LEFT JOIN units u ON u.id = b.unit_id AND u.org_id = b.org_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(
        CASE WHEN pm.is_reversed THEN 0
             WHEN pm.kind = 'refund' THEN -pm.amount
             ELSE pm.amount END
      ), 0) AS collected
      FROM payments pm
      WHERE pm.org_id = b.org_id AND pm.booking_id = b.id
    ) pay ON true
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY COALESCE(b.booked_at, b.token_paid_at, b.created_at) DESC
    LIMIT 300
  `);

  return result.rows as unknown as BookingRow[];
}

export async function getBookingDetail(
  orgId: string,
  bookingId: string,
): Promise<BookingDetail | null> {
  const [bookingResult, paymentResult] = await Promise.all([
    db().execute(sql`
      SELECT b.id, b.reference, b.status, b.lead_id AS "leadId", b.person_id AS "personId",
             b.project_id AS "projectId", b.unit_id AS "unitId",
             l.reference AS "leadReference", p.full_name AS "personName",
             p.primary_phone AS "primaryPhone", pr.name AS "projectName",
             CASE WHEN u.id IS NULL THEN NULL
                  ELSE CONCAT_WS(' · ', NULLIF(u.tower, ''), u.unit_number) END AS "unitLabel",
             b.agreement_value AS "agreementValue", b.token_amount AS "tokenAmount",
             COALESCE(pay.collected, 0)::text AS "collectedAmount",
             b.token_paid_at AS "tokenPaidAt", b.booked_at AS "bookedAt",
             b.agreement_signed_at AS "agreementSignedAt", b.registered_at AS "registeredAt",
             b.cancelled_at AS "cancelledAt", b.cancellation_reason AS "cancellationReason",
             closer.name AS "closedByName", b.created_at AS "createdAt"
      FROM bookings b
      JOIN leads l ON l.id = b.lead_id AND l.org_id = b.org_id
      JOIN persons p ON p.id = b.person_id AND p.org_id = b.org_id
      LEFT JOIN projects pr ON pr.id = b.project_id AND pr.org_id = b.org_id
      LEFT JOIN units u ON u.id = b.unit_id AND u.org_id = b.org_id
      LEFT JOIN users closer ON closer.id = b.closed_by_user_id AND closer.org_id = b.org_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(
          CASE WHEN pm.is_reversed THEN 0
               WHEN pm.kind = 'refund' THEN -pm.amount
               ELSE pm.amount END
        ), 0) AS collected
        FROM payments pm
        WHERE pm.org_id = b.org_id AND pm.booking_id = b.id
      ) pay ON true
      WHERE b.org_id = ${orgId} AND b.id = ${bookingId}
      LIMIT 1
    `),
    db().execute(sql`
      SELECT pm.id, pm.amount, pm.kind, pm.mode, pm.reference,
             pm.received_at AS "receivedAt", pm.is_reversed AS "isReversed",
             u.name AS "recordedByName"
      FROM payments pm
      LEFT JOIN users u ON u.id = pm.recorded_by_user_id AND u.org_id = pm.org_id
      WHERE pm.org_id = ${orgId} AND pm.booking_id = ${bookingId}
      ORDER BY pm.received_at DESC, pm.created_at DESC
    `),
  ]);

  const booking = (bookingResult.rows as unknown as Omit<BookingDetail, "payments">[])[0];
  if (!booking) return null;
  return {
    ...booking,
    payments: paymentResult.rows as unknown as BookingPaymentRow[],
  };
}

export interface CommercialReports {
  inventory: {
    total: number;
    available: number;
    held: number;
    tokenPaid: number;
    booked: number;
    registered: number;
    blocked: number;
    availableValue: number;
  };
  funnel: {
    leads: number;
    qualified: number;
    scheduledVisits: number;
    completedVisits: number;
    tokenBookings: number;
    confirmedBookings: number;
  };
  bookings: {
    active: number;
    cancelled: number;
    agreementValue: number;
    collected: number;
    refunded: number;
    outstanding: number;
  };
  agents: {
    id: string;
    name: string;
    leads: number;
    visits: number;
    bookings: number;
    agreementValue: number;
    collections: number;
  }[];
  campaigns: {
    platform: string | null;
    campaignId: string;
    campaignName: string | null;
    spend: number;
    leads: number;
    qualified: number;
    visits: number;
    bookings: number;
    agreementValue: number;
    collections: number;
  }[];
  creatives: {
    platform: string | null;
    campaignName: string | null;
    creativeId: string;
    creativeName: string | null;
    leads: number;
    visits: number;
    bookings: number;
    agreementValue: number;
  }[];
}

export async function getCommercialReports(
  orgId: string,
  input: { days?: number; projectId?: string } = {},
): Promise<CommercialReports> {
  const days = Math.max(1, Math.min(input.days ?? 90, 730));
  const projectId = input.projectId ?? null;
  const projectClause = sql`(${projectId}::uuid IS NULL OR l.project_id = ${projectId}::uuid)`;

  const [inventoryResult, funnelResult, bookingResult, agentResult, campaignResult, creativeResult] =
    await Promise.all([
      db().execute(sql`
        WITH inventory_truth AS (
          SELECT u.all_in_price,
            CASE
              WHEN b.status = 'token' THEN 'token_paid'
              WHEN b.status IN ('booked', 'agreement_signed') THEN 'booked'
              WHEN b.status = 'registered' THEN 'registered'
              WHEN h.id IS NOT NULL THEN 'held'
              WHEN u.status = 'held' THEN 'available'
              WHEN u.status IN ('token_paid', 'booked', 'registered') THEN 'blocked'
              ELSE u.status::text
            END AS status
          FROM units u
          LEFT JOIN LATERAL (
            SELECT bk.status FROM bookings bk
            WHERE bk.org_id = u.org_id AND bk.unit_id = u.id AND bk.status <> 'cancelled'
            ORDER BY bk.created_at DESC LIMIT 1
          ) b ON true
          LEFT JOIN LATERAL (
            SELECT uh.id FROM unit_holds uh
            WHERE uh.org_id = u.org_id AND uh.unit_id = u.id
              AND uh.released_at IS NULL AND uh.expires_at > now()
            ORDER BY uh.created_at DESC LIMIT 1
          ) h ON true
          WHERE u.org_id = ${orgId}
            AND (${projectId}::uuid IS NULL OR u.project_id = ${projectId}::uuid)
        )
        SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'available')::int AS available,
          COUNT(*) FILTER (WHERE status = 'held')::int AS held,
          COUNT(*) FILTER (WHERE status = 'token_paid')::int AS "tokenPaid",
          COUNT(*) FILTER (WHERE status = 'booked')::int AS booked,
          COUNT(*) FILTER (WHERE status = 'registered')::int AS registered,
          COUNT(*) FILTER (WHERE status = 'blocked')::int AS blocked,
          COALESCE(SUM(all_in_price) FILTER (WHERE status = 'available'), 0)::float AS "availableValue"
        FROM inventory_truth
      `),
      db().execute(sql`
        WITH cohort AS (
          SELECT l.id
          FROM leads l
          WHERE l.org_id = ${orgId} AND l.is_test = false
            AND l.created_at >= now() - ${days} * interval '1 day'
            AND ${projectClause}
        )
        SELECT COUNT(*)::int AS leads,
          COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM lead_stage_history h
            WHERE h.lead_id = c.id AND h.to_stage = 'qualified'
          ))::int AS qualified,
          COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM visits v
            WHERE v.lead_id = c.id AND v.scheduled_at IS NOT NULL
              AND v.status <> 'cancelled'
          ))::int AS "scheduledVisits",
          COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM visits v
            WHERE v.lead_id = c.id AND v.arrived_at IS NOT NULL
              AND v.status IN ('arrived', 'completed')
          ))::int AS "completedVisits",
          COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM bookings b
            WHERE b.lead_id = c.id AND b.token_paid_at IS NOT NULL
          ))::int AS "tokenBookings",
          COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM bookings b
            WHERE b.lead_id = c.id AND b.booked_at IS NOT NULL
          ))::int AS "confirmedBookings"
        FROM cohort c
      `),
      db().execute(sql`
        WITH current_bookings AS (
          SELECT b.*
          FROM bookings b
          WHERE b.org_id = ${orgId}
            AND b.status <> 'cancelled'
            AND (${projectId}::uuid IS NULL OR b.project_id = ${projectId}::uuid)
        ), period_cancellations AS (
          SELECT b.id
          FROM bookings b
          WHERE b.org_id = ${orgId}
            AND b.status = 'cancelled'
            AND b.cancelled_at >= now() - ${days} * interval '1 day'
            AND (${projectId}::uuid IS NULL OR b.project_id = ${projectId}::uuid)
        ), period_payments AS (
          SELECT pm.*
          FROM payments pm
          JOIN bookings b ON b.id = pm.booking_id AND b.org_id = pm.org_id
          WHERE pm.org_id = ${orgId} AND pm.is_reversed = false
            AND pm.received_at >= now() - ${days} * interval '1 day'
            AND (${projectId}::uuid IS NULL OR b.project_id = ${projectId}::uuid)
        ), current_payments AS (
          SELECT pm.*
          FROM payments pm
          JOIN current_bookings b ON b.id = pm.booking_id
          WHERE pm.org_id = ${orgId} AND pm.is_reversed = false
        )
        SELECT
          (SELECT COUNT(*)::int FROM current_bookings) AS active,
          (SELECT COUNT(*)::int FROM period_cancellations) AS cancelled,
          COALESCE((SELECT SUM(agreement_value) FROM current_bookings), 0)::float AS "agreementValue",
          COALESCE((SELECT SUM(amount) FROM period_payments WHERE kind <> 'refund'), 0)::float AS collected,
          COALESCE((SELECT SUM(amount) FROM period_payments WHERE kind = 'refund'), 0)::float AS refunded,
          GREATEST(
            COALESCE((SELECT SUM(agreement_value) FROM current_bookings), 0)
            - COALESCE((SELECT SUM(CASE WHEN kind = 'refund' THEN -amount ELSE amount END)
                        FROM current_payments), 0),
            0
          )::float AS outstanding
      `),
      db().execute(sql`
        WITH agent_leads AS (
          SELECT owner_user_id AS user_id, COUNT(*)::int AS leads
          FROM leads l
          WHERE l.org_id = ${orgId} AND l.is_test = false
            AND l.created_at >= now() - ${days} * interval '1 day'
            AND ${projectClause}
          GROUP BY owner_user_id
        ), agent_visits AS (
          SELECT COALESCE(v.host_user_id, l.owner_user_id) AS user_id,
                 COUNT(DISTINCT v.id)::int AS visits
          FROM visits v JOIN leads l ON l.id = v.lead_id AND l.org_id = v.org_id
          WHERE v.org_id = ${orgId} AND v.arrived_at >= now() - ${days} * interval '1 day'
            AND v.status IN ('arrived', 'completed') AND ${projectClause}
          GROUP BY COALESCE(v.host_user_id, l.owner_user_id)
        ), agent_bookings AS (
          SELECT b.closed_by_user_id AS user_id, COUNT(*) FILTER (WHERE b.status <> 'cancelled')::int AS bookings,
                 COALESCE(SUM(b.agreement_value) FILTER (WHERE b.status <> 'cancelled'), 0)::float AS agreement_value
          FROM bookings b
          WHERE b.org_id = ${orgId} AND b.booked_at >= now() - ${days} * interval '1 day'
            AND (${projectId}::uuid IS NULL OR b.project_id = ${projectId}::uuid)
          GROUP BY b.closed_by_user_id
        ), agent_collections AS (
          SELECT b.closed_by_user_id AS user_id,
                 COALESCE(SUM(CASE WHEN pm.kind = 'refund' THEN -pm.amount ELSE pm.amount END), 0)::float AS collections
          FROM payments pm
          JOIN bookings b ON b.id = pm.booking_id AND b.org_id = pm.org_id
          WHERE pm.org_id = ${orgId} AND pm.is_reversed = false
            AND pm.received_at >= now() - ${days} * interval '1 day'
            AND (${projectId}::uuid IS NULL OR b.project_id = ${projectId}::uuid)
          GROUP BY b.closed_by_user_id
        )
        SELECT u.id, u.name, COALESCE(al.leads, 0)::int AS leads,
               COALESCE(av.visits, 0)::int AS visits,
               COALESCE(ab.bookings, 0)::int AS bookings,
               COALESCE(ab.agreement_value, 0)::float AS "agreementValue",
               COALESCE(ac.collections, 0)::float AS collections
        FROM users u
        LEFT JOIN agent_leads al ON al.user_id = u.id
        LEFT JOIN agent_visits av ON av.user_id = u.id
        LEFT JOIN agent_bookings ab ON ab.user_id = u.id
        LEFT JOIN agent_collections ac ON ac.user_id = u.id
        WHERE u.org_id = ${orgId} AND u.is_active = true
          AND u.role IN ('sales_agent', 'sales_manager')
        ORDER BY bookings DESC, visits DESC, leads DESC, u.name
      `),
      db().execute(sql`
        WITH cohort AS (
          SELECT l.id, t.ad_platform AS platform, t.campaign_id, t.campaign_name,
                 EXISTS (SELECT 1 FROM lead_stage_history h WHERE h.lead_id = l.id AND h.to_stage = 'qualified') AS qualified,
                 EXISTS (SELECT 1 FROM visits v WHERE v.lead_id = l.id AND v.arrived_at IS NOT NULL AND v.status IN ('arrived','completed')) AS visited
          FROM leads l
          JOIN lead_touchpoints t ON t.id = l.first_touchpoint_id AND t.org_id = l.org_id
          WHERE l.org_id = ${orgId} AND l.is_test = false
            AND l.created_at >= now() - ${days} * interval '1 day'
            AND ${projectClause} AND t.campaign_id IS NOT NULL
        ), booking_facts AS (
          SELECT b.id, b.lead_id, b.status, b.agreement_value,
                 COALESCE(SUM(CASE
                   WHEN pm.is_reversed THEN 0
                   WHEN pm.kind = 'refund' THEN -pm.amount
                   ELSE pm.amount
                 END), 0) AS collected
          FROM bookings b
          LEFT JOIN payments pm ON pm.booking_id = b.id AND pm.org_id = b.org_id
          WHERE b.org_id = ${orgId}
          GROUP BY b.id, b.lead_id, b.status, b.agreement_value
        ), lead_outcomes AS (
          SELECT c.id, c.platform, c.campaign_id, c.campaign_name, c.qualified, c.visited,
                 COUNT(b.id) FILTER (WHERE b.status <> 'cancelled')::int AS bookings,
                 COALESCE(SUM(b.agreement_value) FILTER (WHERE b.status <> 'cancelled'), 0) AS agreement_value,
                 COALESCE(SUM(b.collected) FILTER (WHERE b.status <> 'cancelled'), 0) AS collections
          FROM cohort c
          LEFT JOIN booking_facts b ON b.lead_id = c.id
          GROUP BY c.id, c.platform, c.campaign_id, c.campaign_name, c.qualified, c.visited
        ), outcomes AS (
          SELECT platform, campaign_id, MAX(campaign_name) AS campaign_name,
                 COUNT(*)::int AS leads,
                 COUNT(*) FILTER (WHERE qualified)::int AS qualified,
                 COUNT(*) FILTER (WHERE visited)::int AS visits,
                 COALESCE(SUM(bookings), 0)::int AS bookings,
                 COALESCE(SUM(agreement_value), 0)::float AS agreement_value,
                 COALESCE(SUM(collections), 0)::float AS collections
          FROM lead_outcomes
          GROUP BY platform, campaign_id
        ), spend AS (
          SELECT platform, campaign_id, MAX(campaign_name) AS campaign_name,
                 SUM(spend)::float AS spend
          FROM ad_spend_daily
          WHERE org_id = ${orgId}
            AND date >= to_char(now() - ${days} * interval '1 day', 'YYYY-MM-DD')
            AND ${projectId}::uuid IS NULL
          GROUP BY platform, campaign_id
        )
        SELECT COALESCE(o.platform, s.platform) AS platform,
               COALESCE(o.campaign_id, s.campaign_id) AS "campaignId",
               COALESCE(o.campaign_name, s.campaign_name) AS "campaignName",
               COALESCE(s.spend, 0)::float AS spend,
               COALESCE(o.leads, 0)::int AS leads,
               COALESCE(o.qualified, 0)::int AS qualified,
               COALESCE(o.visits, 0)::int AS visits,
               COALESCE(o.bookings, 0)::int AS bookings,
               COALESCE(o.agreement_value, 0)::float AS "agreementValue",
               COALESCE(o.collections, 0)::float AS collections
        FROM outcomes o
        FULL OUTER JOIN spend s ON s.platform = o.platform AND s.campaign_id = o.campaign_id
        ORDER BY COALESCE(s.spend, 0) DESC, COALESCE(o.bookings, 0) DESC
        LIMIT 100
      `),
      db().execute(sql`
        WITH cohort AS (
          SELECT l.id, t.ad_platform AS platform, t.campaign_name,
                 COALESCE(t.creative_id, t.ad_id, t.utm_content, 'unresolved') AS creative_id,
                 COALESCE(t.creative_name, t.ad_name, t.utm_content) AS creative_name,
                 EXISTS (
                   SELECT 1 FROM visits v
                   WHERE v.lead_id = l.id AND v.org_id = l.org_id
                     AND v.arrived_at IS NOT NULL AND v.status IN ('arrived','completed')
                 ) AS visited
          FROM leads l
          JOIN lead_touchpoints t ON t.id = l.first_touchpoint_id AND t.org_id = l.org_id
          WHERE l.org_id = ${orgId} AND l.is_test = false
            AND l.created_at >= now() - ${days} * interval '1 day'
            AND ${projectClause}
        ), booking_facts AS (
          SELECT b.lead_id,
                 COUNT(*) FILTER (WHERE b.status <> 'cancelled')::int AS bookings,
                 COALESCE(SUM(b.agreement_value) FILTER (WHERE b.status <> 'cancelled'), 0) AS agreement_value
          FROM bookings b
          WHERE b.org_id = ${orgId}
          GROUP BY b.lead_id
        )
        SELECT c.platform, MAX(c.campaign_name) AS "campaignName",
               c.creative_id AS "creativeId", MAX(c.creative_name) AS "creativeName",
               COUNT(*)::int AS leads,
               COUNT(*) FILTER (WHERE c.visited)::int AS visits,
               COALESCE(SUM(b.bookings), 0)::int AS bookings,
               COALESCE(SUM(b.agreement_value), 0)::float AS "agreementValue"
        FROM cohort c
        LEFT JOIN booking_facts b ON b.lead_id = c.id
        GROUP BY c.platform, c.creative_id
        ORDER BY bookings DESC, visits DESC, leads DESC
        LIMIT 100
      `),
    ]);

  const inventory = (inventoryResult.rows as unknown as CommercialReports["inventory"][])[0] ?? {
    total: 0,
    available: 0,
    held: 0,
    tokenPaid: 0,
    booked: 0,
    registered: 0,
    blocked: 0,
    availableValue: 0,
  };
  const funnel = (funnelResult.rows as unknown as CommercialReports["funnel"][])[0] ?? {
    leads: 0,
    qualified: 0,
    scheduledVisits: 0,
    completedVisits: 0,
    tokenBookings: 0,
    confirmedBookings: 0,
  };
  const bookingsSummary = (bookingResult.rows as unknown as CommercialReports["bookings"][])[0] ?? {
    active: 0,
    cancelled: 0,
    agreementValue: 0,
    collected: 0,
    refunded: 0,
    outstanding: 0,
  };

  return {
    inventory,
    funnel,
    bookings: bookingsSummary,
    agents: agentResult.rows as unknown as CommercialReports["agents"],
    campaigns: campaignResult.rows as unknown as CommercialReports["campaigns"],
    creatives: creativeResult.rows as unknown as CommercialReports["creatives"],
  };
}

export interface CashMovementPoint {
  label: string;
  /** Money in, refunds excluded. */
  collected: number;
  /** Money out, kept positive here and mirrored below the axis by the chart. */
  refunded: number;
  /** collected − refunded, so the line crosses zero when a period gives back
   *  more than it took. */
  net: number;
}

/**
 * Cash in and cash out, bucketed across the reporting period.
 *
 * Refunds are a first-class series rather than a number netted off silently:
 * a month that collected ₹80L and refunded ₹50L is a very different month from
 * one that collected ₹30L, and a single "net" figure makes those identical.
 */
export async function getCashMovement(
  orgId: string,
  filters: { days: number; projectId?: string } = { days: 90 },
): Promise<CashMovementPoint[]> {
  const days = Math.max(7, Math.min(filters.days, 730));
  // Weekly resolution reads well up to a few months; beyond that the bars stop
  // being distinguishable and monthly is the honest granularity.
  const grain = days <= 120 ? "week" : "month";
  const projectId = filters.projectId ?? null;

  const result = await db().execute(sql`
    WITH buckets AS (
      SELECT generate_series(
        date_trunc(${grain}, now() - ${days} * interval '1 day'),
        date_trunc(${grain}, now()),
        ('1 ' || ${grain})::interval
      ) AS bucket
    )
    SELECT
      to_char(b.bucket, ${grain === "week" ? sql`'DD Mon'` : sql`'Mon YY'`}) AS label,
      COALESCE(SUM(pm.amount) FILTER (WHERE pm.kind <> 'refund'), 0)::float AS collected,
      COALESCE(SUM(pm.amount) FILTER (WHERE pm.kind = 'refund'), 0)::float AS refunded,
      COALESCE(SUM(CASE WHEN pm.kind = 'refund' THEN -pm.amount ELSE pm.amount END), 0)::float AS net
    FROM buckets b
    LEFT JOIN payments pm
      ON date_trunc(${grain}, pm.received_at) = b.bucket
     AND pm.org_id = ${orgId}
     AND pm.is_reversed = false
    LEFT JOIN bookings bk ON bk.id = pm.booking_id AND bk.org_id = pm.org_id
    WHERE (${projectId}::uuid IS NULL OR bk.project_id = ${projectId}::uuid OR pm.id IS NULL)
    GROUP BY b.bucket
    ORDER BY b.bucket
  `);
  return result.rows as unknown as CashMovementPoint[];
}
