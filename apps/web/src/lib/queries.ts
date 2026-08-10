import { getDb } from "@monark/db";
import { sql } from "drizzle-orm";

const db = () => getDb();

/**
 * Funnel counts.
 *
 * Counts leads that EVER REACHED each stage, derived from `lead_stage_history`
 * — not leads currently sitting in it. This is the high-water-mark rule from
 * the pipeline design, and getting it wrong makes the funnel nonsense: a lead
 * that booked would otherwise vanish from the "qualified" count, so deeper
 * stages could show more leads than shallower ones.
 *
 * Terminal stages are excluded from the ladder and reported separately.
 */
export async function getFunnel(orgId: string, sinceDays = 90) {
  const result = await db().execute(sql`
    WITH scoped AS (
      SELECT l.id
      FROM leads l
      WHERE l.org_id = ${orgId}
        AND l.is_test = false
        AND l.created_at >= now() - (${sinceDays} || ' days')::interval
    ),
    reached AS (
      SELECT DISTINCT h.lead_id, h.to_stage::text AS stage
      FROM lead_stage_history h
      JOIN scoped s ON s.id = h.lead_id
      WHERE h.to_stage NOT IN ('lost', 'disqualified')
    ),
    ranked AS (
      SELECT stage, COUNT(DISTINCT lead_id)::int AS leads
      FROM reached GROUP BY stage
    )
    SELECT
      st.stage,
      COALESCE(r.leads, 0) AS leads,
      (SELECT COUNT(*)::int FROM scoped) AS total
    FROM (VALUES
      ('new',1),('contacted',2),('qualified',3),('visit_scheduled',4),
      ('visited',5),('negotiating',6),('token_paid',7),('booked',8)
    ) AS st(stage, ord)
    LEFT JOIN ranked r ON r.stage = st.stage
    ORDER BY st.ord
  `);

  return result.rows as unknown as { stage: string; leads: number; total: number }[];
}

/** Headline numbers for the overview. */
export async function getOverviewStats(orgId: string) {
  const result = await db().execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM leads
        WHERE org_id = ${orgId} AND is_test = false
          AND created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')) AS "leadsToday",
      (SELECT COUNT(*)::int FROM leads
        WHERE org_id = ${orgId} AND is_test = false AND stage = 'new') AS "unworked",
      (SELECT COUNT(*)::int FROM leads
        WHERE org_id = ${orgId} AND is_test = false
          AND stage NOT IN ('booked','lost','disqualified')
          AND next_follow_up_at < now()) AS "overdue",
      (SELECT COUNT(*)::int FROM leads
        WHERE org_id = ${orgId} AND is_test = false
          AND stage = 'new' AND created_at < now() - interval '24 hours') AS "untouched24h",
      (SELECT COUNT(*)::int FROM visits
        WHERE org_id = ${orgId}
          AND scheduled_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')
          AND scheduled_at <  date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '1 day'
      ) AS "visitsToday",
      (SELECT COUNT(*)::int FROM visits
        WHERE org_id = ${orgId} AND arrived_at >= now() - interval '30 days') AS "visits30d",
      (SELECT COUNT(*)::int FROM bookings
        WHERE org_id = ${orgId} AND booked_at >= now() - interval '30 days'
          AND status <> 'cancelled') AS "bookings30d",
      (SELECT COALESCE(ROUND(AVG(first_response_seconds)), 0)::int FROM leads
        WHERE org_id = ${orgId} AND is_test = false
          AND first_response_seconds IS NOT NULL
          AND created_at >= now() - interval '30 days') AS "medianResponseSeconds"
  `);

  return (result.rows as unknown as Record<string, number>[])[0] ?? {};
}

/**
 * Leads whose Google attribution window is about to close.
 *
 * The operational expression of the 90-day GCLID wall: these are leads where
 * any conversion logged after the deadline can never be credited to the click
 * that produced them. Worth chasing before the clock runs out.
 */
export async function getExpiringAttribution(orgId: string, limit = 8) {
  const result = await db().execute(sql`
    SELECT
      l.id, l.reference, p.full_name AS "fullName",
      t.attribution_expires_at AS "expiresAt",
      t.campaign_name AS "campaignName",
      l.stage::text AS stage
    FROM leads l
    JOIN persons p ON p.id = l.person_id
    JOIN lead_touchpoints t ON t.id = l.first_touchpoint_id
    WHERE l.org_id = ${orgId}
      AND l.is_test = false
      AND l.stage NOT IN ('booked','lost','disqualified')
      AND t.attribution_expires_at IS NOT NULL
      AND t.attribution_expires_at > now()
      AND t.attribution_expires_at < now() + interval '21 days'
    ORDER BY t.attribution_expires_at ASC
    LIMIT ${limit}
  `);
  return result.rows as unknown as {
    id: string; reference: string; fullName: string | null;
    expiresAt: string; campaignName: string | null; stage: string;
  }[];
}

export interface LeadFilters {
  stage?: string;
  ownerId?: string;
  search?: string;
  source?: string;
  limit?: number;
  offset?: number;
}

export async function listLeads(orgId: string, filters: LeadFilters = {}) {
  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = filters.offset ?? 0;

  const conditions = [sql`l.org_id = ${orgId}`, sql`l.is_test = false`];
  if (filters.stage) conditions.push(sql`l.stage = ${filters.stage}::lead_stage`);
  if (filters.ownerId) conditions.push(sql`l.owner_user_id = ${filters.ownerId}`);
  if (filters.source) conditions.push(sql`t.source = ${filters.source}::touchpoint_source`);
  if (filters.search) {
    // Phone lookups dominate in practice — a salesperson has the number in
    // front of them and nothing else. Matching on the normalised form means
    // "9876543210" finds "+919876543210".
    const term = `%${filters.search.replace(/[%_]/g, "")}%`;
    conditions.push(sql`(
      p.full_name ILIKE ${term}
      OR p.primary_phone ILIKE ${term}
      OR p.primary_email ILIKE ${term}
      OR l.reference ILIKE ${term}
    )`);
  }

  const where = sql.join(conditions, sql` AND `);

  const result = await db().execute(sql`
    SELECT
      l.id, l.reference, l.stage::text AS stage, l.score,
      l.created_at AS "createdAt", l.last_activity_at AS "lastActivityAt",
      l.next_follow_up_at AS "nextFollowUpAt", l.first_response_seconds AS "firstResponseSeconds",
      p.full_name AS "fullName", p.primary_phone AS "primaryPhone", p.city,
      u.name AS "ownerName",
      pr.name AS "projectName",
      t.source::text AS source, t.ad_platform AS "adPlatform",
      t.campaign_name AS "campaignName", t.attribution_expires_at AS "attributionExpiresAt",
      COUNT(*) OVER()::int AS "totalCount"
    FROM leads l
    JOIN persons p ON p.id = l.person_id
    LEFT JOIN users u ON u.id = l.owner_user_id
    LEFT JOIN projects pr ON pr.id = l.project_id
    LEFT JOIN lead_touchpoints t ON t.id = l.first_touchpoint_id
    WHERE ${where}
    ORDER BY l.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  return result.rows as unknown as LeadRow[];
}

export interface LeadRow {
  id: string; reference: string; stage: string; score: number;
  createdAt: string; lastActivityAt: string | null; nextFollowUpAt: string | null;
  firstResponseSeconds: number | null;
  fullName: string | null; primaryPhone: string | null; city: string | null;
  ownerName: string | null; projectName: string | null;
  source: string | null; adPlatform: string | null; campaignName: string | null;
  attributionExpiresAt: string | null; totalCount: number;
}

/** Everything the lead detail page needs, in one round trip per section. */
export async function getLeadDetail(orgId: string, leadId: string) {
  const [leadRes, touchpointsRes, historyRes, activitiesRes, visitsRes, qualRes] =
    await Promise.all([
      db().execute(sql`
        SELECT l.*, l.stage::text AS stage_text, l.sub_status::text AS sub_status_text,
               l.lost_reason::text AS lost_reason_text,
               p.full_name, p.primary_phone, p.primary_email, p.city, p.state,
               p.is_nri, p.is_suppressed, p.id AS person_id,
               u.name AS owner_name, pr.name AS project_name
        FROM leads l
        JOIN persons p ON p.id = l.person_id
        LEFT JOIN users u ON u.id = l.owner_user_id
        LEFT JOIN projects pr ON pr.id = l.project_id
        WHERE l.org_id = ${orgId} AND l.id = ${leadId}
        LIMIT 1
      `),
      db().execute(sql`
        SELECT id, source::text AS source, source_detail, ad_platform, campaign_name,
               adset_name, ad_name, creative_name, keyword, utm_source, utm_medium,
               utm_campaign, utm_content, landing_page, gclid, gbraid, wbraid, fbclid,
               ctwa_clid, occurred_at, clicked_at, attribution_expires_at
        FROM lead_touchpoints
        WHERE lead_id = ${leadId} ORDER BY occurred_at ASC
      `),
      db().execute(sql`
        SELECT h.id, h.from_stage::text AS from_stage, h.to_stage::text AS to_stage,
               h.reason, h.created_at, h.duration_in_previous_seconds, u.name AS changed_by
        FROM lead_stage_history h
        LEFT JOIN users u ON u.id = h.changed_by_user_id
        WHERE h.lead_id = ${leadId} ORDER BY h.created_at ASC
      `),
      db().execute(sql`
        SELECT a.id, a.type, a.direction, a.subject, a.body, a.occurred_at,
               a.call_duration_seconds, a.call_outcome, u.name AS user_name
        FROM activities a
        LEFT JOIN users u ON u.id = a.user_id
        WHERE a.lead_id = ${leadId} ORDER BY a.occurred_at DESC LIMIT 100
      `),
      db().execute(sql`
        SELECT v.id, v.type::text AS type, v.status::text AS status, v.scheduled_at,
               v.arrived_at, v.duration_minutes, v.accompanying_count, v.intent_rating,
               v.notes, v.check_in_method, u.name AS host_name
        FROM visits v LEFT JOIN users u ON u.id = v.host_user_id
        WHERE v.lead_id = ${leadId} ORDER BY COALESCE(v.arrived_at, v.scheduled_at) DESC
      `),
      db().execute(sql`
        SELECT quality::text AS quality, budget_min, budget_max, desired_configuration,
               purchase_timeline, funding_mode, is_decision_maker, notes, created_at
        FROM lead_qualifications WHERE lead_id = ${leadId}
        ORDER BY created_at DESC LIMIT 1
      `),
    ]);

  const lead = (leadRes.rows as any[])[0];
  if (!lead) return null;

  return {
    lead,
    touchpoints: touchpointsRes.rows as any[],
    history: historyRes.rows as any[],
    activities: activitiesRes.rows as any[],
    visits: visitsRes.rows as any[],
    qualification: (qualRes.rows as any[])[0] ?? null,
  };
}

/** Leads grouped by stage for the kanban board. */
export async function getPipeline(orgId: string, ownerId?: string) {
  const conditions = [
    sql`l.org_id = ${orgId}`,
    sql`l.is_test = false`,
    sql`l.stage NOT IN ('lost','disqualified')`,
  ];
  if (ownerId) conditions.push(sql`l.owner_user_id = ${ownerId}`);

  const result = await db().execute(sql`
    SELECT l.id, l.reference, l.stage::text AS stage, l.score,
           l.next_follow_up_at AS "nextFollowUpAt", l.created_at AS "createdAt",
           p.full_name AS "fullName", p.primary_phone AS "primaryPhone",
           u.name AS "ownerName", t.ad_platform AS "adPlatform",
           t.attribution_expires_at AS "attributionExpiresAt"
    FROM leads l
    JOIN persons p ON p.id = l.person_id
    LEFT JOIN users u ON u.id = l.owner_user_id
    LEFT JOIN lead_touchpoints t ON t.id = l.first_touchpoint_id
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY l.score DESC, l.created_at DESC
    LIMIT 400
  `);
  return result.rows as unknown as (LeadRow & { attributionExpiresAt: string | null })[];
}

/** Walk-in lookup. Phone is the only identifier a receptionist reliably has. */
export async function searchForCheckIn(orgId: string, query: string) {
  const digits = query.replace(/\D/g, "");
  if (digits.length < 4 && query.trim().length < 3) return [];

  const term = `%${digits.length >= 4 ? digits.slice(-10) : query.trim()}%`;

  const result = await db().execute(sql`
    SELECT l.id, l.reference, l.stage::text AS stage,
           p.full_name AS "fullName", p.primary_phone AS "primaryPhone", p.city,
           pr.name AS "projectName", u.name AS "ownerName",
           t.ad_platform AS "adPlatform", t.campaign_name AS "campaignName",
           t.creative_name AS "creativeName", l.created_at AS "createdAt"
    FROM leads l
    JOIN persons p ON p.id = l.person_id
    LEFT JOIN projects pr ON pr.id = l.project_id
    LEFT JOIN users u ON u.id = l.owner_user_id
    LEFT JOIN lead_touchpoints t ON t.id = l.first_touchpoint_id
    WHERE l.org_id = ${orgId}
      AND (p.primary_phone ILIKE ${term} OR p.full_name ILIKE ${term} OR l.reference ILIKE ${term})
      AND l.stage NOT IN ('lost','disqualified')
    ORDER BY l.created_at DESC
    LIMIT 10
  `);
  return result.rows as unknown as {
    id: string; reference: string; stage: string; fullName: string | null;
    primaryPhone: string | null; city: string | null; projectName: string | null;
    ownerName: string | null; adPlatform: string | null; campaignName: string | null;
    creativeName: string | null; createdAt: string;
  }[];
}

/**
 * Campaign performance, joined all the way to outcomes.
 *
 * This is the report the whole platform exists to produce. A campaign table
 * that stops at cost-per-lead actively misleads — it makes the campaign
 * generating thousands of cheap, worthless form fills look like the winner.
 * Carrying spend through to site visits and bookings is what reverses that.
 */
export async function getCampaignPerformance(orgId: string, days = 90) {
  const result = await db().execute(sql`
    WITH spend AS (
      SELECT platform, campaign_id, MAX(campaign_name) AS campaign_name,
             SUM(spend)::numeric AS spend, SUM(clicks)::int AS clicks
      FROM ad_spend_daily
      WHERE org_id = ${orgId}
        AND date >= to_char(now() - (${days} || ' days')::interval, 'YYYY-MM-DD')
      GROUP BY platform, campaign_id
    ),
    lead_stages AS (
      SELECT t.ad_platform AS platform, t.campaign_id, MAX(t.campaign_name) AS campaign_name,
             l.id AS lead_id,
             BOOL_OR(h.to_stage = 'qualified')  AS reached_qualified,
             BOOL_OR(h.to_stage = 'visited')    AS reached_visited,
             BOOL_OR(h.to_stage = 'booked')     AS reached_booked
      FROM leads l
      JOIN lead_touchpoints t ON t.id = l.first_touchpoint_id
      LEFT JOIN lead_stage_history h ON h.lead_id = l.id
      WHERE l.org_id = ${orgId} AND l.is_test = false
        AND l.created_at >= now() - (${days} || ' days')::interval
        AND t.campaign_id IS NOT NULL
      GROUP BY t.ad_platform, t.campaign_id, l.id
    ),
    outcomes AS (
      SELECT platform, campaign_id, MAX(campaign_name) AS campaign_name,
             COUNT(*)::int AS leads,
             COUNT(*) FILTER (WHERE reached_qualified)::int AS qualified,
             COUNT(*) FILTER (WHERE reached_visited)::int  AS visits,
             COUNT(*) FILTER (WHERE reached_booked)::int   AS bookings
      FROM lead_stages GROUP BY platform, campaign_id
    )
    SELECT
      COALESCE(o.platform, s.platform) AS platform,
      COALESCE(o.campaign_id, s.campaign_id) AS "campaignId",
      COALESCE(o.campaign_name, s.campaign_name) AS "campaignName",
      COALESCE(s.spend, 0)::float AS spend,
      COALESCE(o.leads, 0) AS leads,
      COALESCE(o.qualified, 0) AS qualified,
      COALESCE(o.visits, 0) AS visits,
      COALESCE(o.bookings, 0) AS bookings
    FROM outcomes o
    FULL OUTER JOIN spend s
      ON s.platform = o.platform AND s.campaign_id = o.campaign_id
    ORDER BY COALESCE(s.spend, 0) DESC
    LIMIT 100
  `);
  return result.rows as unknown as {
    platform: string | null; campaignId: string; campaignName: string | null;
    spend: number; leads: number; qualified: number; visits: number; bookings: number;
  }[];
}

/** Conversion outbox health — the operational heart of the integration. */
export async function getConversionHealth(orgId: string) {
  const [statusRes, lagRes, recentRes, destRes] = await Promise.all([
    db().execute(sql`
      SELECT status::text AS status, COUNT(*)::int AS count
      FROM conversion_deliveries WHERE org_id = ${orgId}
      GROUP BY status ORDER BY count DESC
    `),
    db().execute(sql`
      SELECT COALESCE(EXTRACT(EPOCH FROM (now() - MIN(e.occurred_at))) / 60, 0)::int AS "lagMinutes"
      FROM conversion_deliveries d
      JOIN conversion_events e ON e.id = d.conversion_event_id
      WHERE d.org_id = ${orgId} AND d.status IN ('pending','failed_retryable','in_flight')
    `),
    db().execute(sql`
      SELECT d.id, d.status::text AS status, d.attempt_count AS "attemptCount",
             d.last_error AS "lastError", d.ineligible_reason AS "ineligibleReason",
             d.delivered_at AS "deliveredAt", d.updated_at AS "updatedAt",
             e.event_type::text AS "eventType", e.occurred_at AS "occurredAt",
             e.value, dest.platform::text AS platform, dest.name AS "destinationName",
             dest.dry_run AS "dryRun", l.reference AS "leadReference", l.id AS "leadId"
      FROM conversion_deliveries d
      JOIN conversion_events e ON e.id = d.conversion_event_id
      JOIN conversion_destinations dest ON dest.id = d.destination_id
      LEFT JOIN leads l ON l.id = e.lead_id
      WHERE d.org_id = ${orgId}
      ORDER BY d.updated_at DESC LIMIT 60
    `),
    db().execute(sql`
      SELECT id, platform::text AS platform, name, is_enabled AS "isEnabled",
             dry_run AS "dryRun", last_success_at AS "lastSuccessAt",
             last_error_at AS "lastErrorAt", last_error AS "lastError"
      FROM conversion_destinations WHERE org_id = ${orgId} ORDER BY platform
    `),
  ]);

  return {
    byStatus: statusRes.rows as unknown as { status: string; count: number }[],
    lagMinutes: (lagRes.rows as unknown as { lagMinutes: number }[])[0]?.lagMinutes ?? 0,
    recent: recentRes.rows as any[],
    destinations: destRes.rows as any[],
  };
}

export async function listAgents(orgId: string) {
  const result = await db().execute(sql`
    SELECT id, name, role::text AS role FROM users
    WHERE org_id = ${orgId} AND is_active = true ORDER BY name
  `);
  return result.rows as unknown as { id: string; name: string; role: string }[];
}

/** Per-agent performance. Stops marketing being blamed for a lead nobody rang. */
export async function getAgentPerformance(orgId: string, days = 30) {
  const result = await db().execute(sql`
    SELECT u.id, u.name,
      COUNT(l.id)::int AS leads,
      COUNT(l.id) FILTER (WHERE l.first_contacted_at IS NOT NULL)::int AS contacted,
      COUNT(l.id) FILTER (WHERE EXISTS (
        SELECT 1 FROM lead_stage_history h WHERE h.lead_id = l.id AND h.to_stage = 'visited'
      ))::int AS visits,
      COUNT(l.id) FILTER (WHERE l.stage = 'booked')::int AS bookings,
      COALESCE(ROUND(AVG(l.first_response_seconds)), 0)::int AS "avgResponseSeconds"
    FROM users u
    LEFT JOIN leads l ON l.owner_user_id = u.id
      AND l.is_test = false
      AND l.created_at >= now() - (${days} || ' days')::interval
    WHERE u.org_id = ${orgId} AND u.is_active = true
      AND u.role IN ('sales_agent','sales_manager')
    GROUP BY u.id, u.name ORDER BY bookings DESC, visits DESC
  `);
  return result.rows as unknown as {
    id: string; name: string; leads: number; contacted: number;
    visits: number; bookings: number; avgResponseSeconds: number;
  }[];
}
