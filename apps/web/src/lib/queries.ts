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
export async function getFunnel(orgId: string, sinceDays = 90, ownerId?: string) {
  const result = await db().execute(sql`
    WITH scoped AS (
      SELECT l.id, CASE l.stage::text
        WHEN 'new' THEN 1
        WHEN 'contacted' THEN 2
        WHEN 'qualified' THEN 3
        WHEN 'visit_scheduled' THEN 4
        WHEN 'visited' THEN 5
        WHEN 'negotiating' THEN 6
        WHEN 'token_paid' THEN 7
        WHEN 'booked' THEN 8
        ELSE 1
      END AS current_rank
      FROM leads l
      WHERE l.org_id = ${orgId}
        ${ownerId ? sql`AND l.owner_user_id = ${ownerId}` : sql``}
        AND l.is_test = false
        AND l.created_at >= now() - (${sinceDays} || ' days')::interval
    ),
    progress AS (
      SELECT s.id,
             GREATEST(s.current_rank, COALESCE(MAX(CASE h.to_stage::text
               WHEN 'new' THEN 1
               WHEN 'contacted' THEN 2
               WHEN 'qualified' THEN 3
               WHEN 'visit_scheduled' THEN 4
               WHEN 'visited' THEN 5
               WHEN 'negotiating' THEN 6
               WHEN 'token_paid' THEN 7
               WHEN 'booked' THEN 8
               ELSE NULL
             END), 1))::int AS max_rank
      FROM scoped s
      LEFT JOIN lead_stage_history h ON h.lead_id = s.id
      GROUP BY s.id, s.current_rank
    )
    SELECT
      st.stage,
      COUNT(p.id) FILTER (WHERE p.max_rank >= st.ord)::int AS leads,
      (SELECT COUNT(*)::int FROM scoped) AS total
    FROM (VALUES
      ('new',1),('contacted',2),('qualified',3),('visit_scheduled',4),
      ('visited',5),('negotiating',6),('token_paid',7),('booked',8)
    ) AS st(stage, ord)
    LEFT JOIN progress p ON true
    GROUP BY st.stage, st.ord
    ORDER BY st.ord
  `);

  return result.rows as unknown as { stage: string; leads: number; total: number }[];
}

/** Headline numbers for the overview. */
export async function getOverviewStats(orgId: string, timezone = "Asia/Kolkata", ownerId?: string) {
  const result = await db().execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM leads
        WHERE org_id = ${orgId} AND is_test = false
          ${ownerId ? sql`AND owner_user_id = ${ownerId}` : sql``}
          AND created_at >= (date_trunc('day', now() AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone})
          AND created_at < ((date_trunc('day', now() AT TIME ZONE ${timezone}) + interval '1 day') AT TIME ZONE ${timezone})) AS "leadsToday",
      (SELECT COUNT(*)::int FROM leads
        WHERE org_id = ${orgId} AND is_test = false AND stage = 'new'
          ${ownerId ? sql`AND owner_user_id = ${ownerId}` : sql``}) AS "unworked",
      (SELECT COUNT(*)::int FROM leads
        WHERE org_id = ${orgId} AND is_test = false
          ${ownerId ? sql`AND owner_user_id = ${ownerId}` : sql``}
          AND stage NOT IN ('booked','lost','disqualified')
          AND next_follow_up_at < now()) AS "overdue",
      (SELECT COUNT(*)::int FROM leads
        WHERE org_id = ${orgId} AND is_test = false
          ${ownerId ? sql`AND owner_user_id = ${ownerId}` : sql``}
          AND stage = 'new' AND created_at < now() - interval '24 hours') AS "untouched24h",
      (SELECT COUNT(*)::int FROM visits v
        JOIN leads l ON l.id = v.lead_id AND l.org_id = v.org_id
        WHERE v.org_id = ${orgId}
          ${ownerId ? sql`AND (l.owner_user_id = ${ownerId} OR v.host_user_id = ${ownerId})` : sql``}
          AND v.scheduled_at >= (date_trunc('day', now() AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone})
          AND v.scheduled_at < ((date_trunc('day', now() AT TIME ZONE ${timezone}) + interval '1 day') AT TIME ZONE ${timezone})
      ) AS "visitsToday",
      (SELECT COUNT(*)::int FROM visits v
        JOIN leads l ON l.id = v.lead_id AND l.org_id = v.org_id
        WHERE v.org_id = ${orgId}
          ${ownerId ? sql`AND (l.owner_user_id = ${ownerId} OR v.host_user_id = ${ownerId})` : sql``}
          AND v.arrived_at >= now() - interval '30 days') AS "visits30d",
      (SELECT COUNT(*)::int FROM bookings b
        JOIN leads l ON l.id = b.lead_id AND l.org_id = b.org_id
        WHERE b.org_id = ${orgId}
          ${ownerId ? sql`AND l.owner_user_id = ${ownerId}` : sql``}
          AND b.booked_at >= now() - interval '30 days'
          AND b.status <> 'cancelled') AS "bookings30d",
      (SELECT COUNT(*)::int FROM bookings b
        JOIN leads l ON l.id = b.lead_id AND l.org_id = b.org_id
        WHERE b.org_id = ${orgId}
          ${ownerId ? sql`AND l.owner_user_id = ${ownerId}` : sql``}
          AND b.booked_at >= now() - interval '30 days'
          AND b.status <> 'cancelled'
          AND b.verification_status = 'validated') AS "validatedBookings30d",
      (SELECT COALESCE(
          ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY first_response_seconds)::numeric),
          0
        )::int FROM leads
        WHERE org_id = ${orgId} AND is_test = false
          ${ownerId ? sql`AND owner_user_id = ${ownerId}` : sql``}
          AND first_response_seconds IS NOT NULL
          AND created_at >= now() - interval '30 days') AS "medianResponseSeconds"
  `);

  return (result.rows as unknown as Record<string, number>[])[0] ?? {};
}

/** Daily operating pulse used by the overview chart. */
export async function getOverviewTrend(orgId: string, timezone = "Asia/Kolkata", days = 30, ownerId?: string) {
  const safeDays = Math.max(7, Math.min(days, 90));
  const result = await db().execute(sql`
    WITH calendar AS (
      SELECT generate_series(
        (now() AT TIME ZONE ${timezone})::date - (${safeDays} - 1),
        (now() AT TIME ZONE ${timezone})::date,
        interval '1 day'
      )::date AS day
    )
    SELECT
      c.day::text AS date,
      to_char(c.day, 'DD Mon') AS label,
      (SELECT COUNT(*)::int FROM leads l
        WHERE l.org_id = ${orgId} AND l.is_test = false
          ${ownerId ? sql`AND l.owner_user_id = ${ownerId}` : sql``}
          AND (l.created_at AT TIME ZONE ${timezone})::date = c.day) AS leads,
      (SELECT COUNT(*)::int FROM visits v
        JOIN leads l ON l.id = v.lead_id AND l.org_id = v.org_id
        WHERE v.org_id = ${orgId} AND v.arrived_at IS NOT NULL
          ${ownerId ? sql`AND (l.owner_user_id = ${ownerId} OR v.host_user_id = ${ownerId})` : sql``}
          AND (v.arrived_at AT TIME ZONE ${timezone})::date = c.day) AS visits,
      (SELECT COUNT(*)::int FROM bookings b
        JOIN leads l ON l.id = b.lead_id AND l.org_id = b.org_id
        WHERE b.org_id = ${orgId} AND b.status <> 'cancelled'
          ${ownerId ? sql`AND l.owner_user_id = ${ownerId}` : sql``}
          AND (b.booked_at AT TIME ZONE ${timezone})::date = c.day) AS bookings,
      -- Plotted alongside bookings rather than instead of them: the gap
      -- between the two lines is the day's unverified money, which is the
      -- number worth noticing on a dashboard.
      (SELECT COUNT(*)::int FROM bookings b
        JOIN leads l ON l.id = b.lead_id AND l.org_id = b.org_id
        WHERE b.org_id = ${orgId} AND b.status <> 'cancelled'
          ${ownerId ? sql`AND l.owner_user_id = ${ownerId}` : sql``}
          AND b.verification_status = 'validated'
          AND (b.booked_at AT TIME ZONE ${timezone})::date = c.day) AS "validatedBookings"
    FROM calendar c
    ORDER BY c.day
  `);

  return result.rows as unknown as {
    date: string;
    label: string;
    leads: number;
    visits: number;
    bookings: number;
    validatedBookings: number;
  }[];
}

/**
 * Leads whose Google attribution window is about to close.
 *
 * The operational expression of the 90-day GCLID wall: these are leads where
 * any conversion logged after the deadline can never be credited to the click
 * that produced them. Worth chasing before the clock runs out.
 */
export async function getExpiringAttribution(orgId: string, limit = 8, ownerId?: string) {
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
      ${ownerId ? sql`AND l.owner_user_id = ${ownerId}` : sql``}
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
  includeDisqualified?: boolean;
  limit?: number;
  offset?: number;
}

export async function listLeads(orgId: string, filters: LeadFilters = {}) {
  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = filters.offset ?? 0;

  const conditions = [sql`l.org_id = ${orgId}`, sql`l.is_test = false`];
  if (filters.stage) conditions.push(sql`l.stage = ${filters.stage}::lead_stage`);
  // Disqualified leads stay out of the working list unless explicitly asked
  // for — or unless the stage filter is literally asking for them.
  else if (!filters.includeDisqualified) conditions.push(sql`l.stage <> 'disqualified'`);
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
      -- Same person, more than one opportunity. A returning buyer legitimately
      -- gets a fresh lead, and without this the list reads as a duplicate
      -- customer rather than a repeat one.
      (SELECT COUNT(*)::int FROM leads sib
        WHERE sib.org_id = l.org_id AND sib.person_id = l.person_id) AS "personLeadCount",
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
  /** How many opportunities this person holds in total. >1 means a returning
   *  buyer, not a duplicated customer. */
  personLeadCount: number;
}

/** Everything the lead detail page needs, in one round trip per section. */
export async function getLeadDetail(orgId: string, leadId: string) {
  const [leadRes, touchpointsRes, historyRes, activitiesRes, visitsRes, qualRes, assignmentsRes] =
    await Promise.all([
      db().execute(sql`
        SELECT l.*, l.stage::text AS stage_text, l.sub_status::text AS sub_status_text,
               l.lost_reason::text AS lost_reason_text,
               p.full_name, p.primary_phone, p.primary_email, p.city, p.state,
               p.is_nri, p.is_suppressed, p.id AS person_id,
               u.name AS owner_name, pr.name AS project_name,
               (EXISTS (SELECT 1 FROM visits pv WHERE pv.org_id = l.org_id AND pv.lead_id = l.id) OR
                EXISTS (SELECT 1 FROM unit_interests pui WHERE pui.org_id = l.org_id AND pui.lead_id = l.id) OR
                EXISTS (SELECT 1 FROM bookings pb WHERE pb.org_id = l.org_id AND pb.lead_id = l.id) OR
                EXISTS (SELECT 1 FROM activities pa WHERE pa.org_id = l.org_id AND pa.lead_id = l.id
                  AND pa.metadata->>'kind' = 'negotiation_offer')) AS has_project_locked_facts
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
      // Merged across every opportunity this person holds.
      //
      // A buyer who books and comes back gets a second opportunity by design —
      // the first journey's history has to stay intact — but the *person* is
      // one person, and a log that stops at the opportunity boundary hides
      // half of what the team knows about them.
      db().execute(sql`
        SELECT a.id, a.type, a.direction, a.subject, a.body, a.occurred_at,
               a.call_duration_seconds, a.call_outcome, u.name AS user_name,
               a.lead_id, ol.reference AS lead_reference
        FROM activities a
        LEFT JOIN users u ON u.id = a.user_id
        LEFT JOIN leads ol ON ol.id = a.lead_id AND ol.org_id = a.org_id
        WHERE a.org_id = ${orgId}
          AND (
            a.lead_id = ${leadId}
            OR a.person_id = (SELECT person_id FROM leads WHERE id = ${leadId} AND org_id = ${orgId})
          )
        ORDER BY a.occurred_at DESC LIMIT 100
      `),
      db().execute(sql`
        SELECT v.id, v.type::text AS type, v.status::text AS status, v.scheduled_at,
               v.arrived_at, v.duration_minutes, v.accompanying_count,
               v.accompanying_relations, v.intent_rating, v.configurations_viewed,
               v.units_viewed, v.objections, v.next_action,
               v.notes, v.check_in_method, v.host_user_id, u.name AS host_name
               , v.lead_id, ov.reference AS lead_reference
        FROM visits v
        LEFT JOIN users u ON u.id = v.host_user_id
        LEFT JOIN leads ov ON ov.id = v.lead_id AND ov.org_id = v.org_id
        WHERE v.org_id = ${orgId}
          AND (
            v.lead_id = ${leadId}
            OR v.person_id = (SELECT person_id FROM leads WHERE id = ${leadId} AND org_id = ${orgId})
          )
        ORDER BY COALESCE(v.arrived_at, v.scheduled_at) DESC
      `),
      db().execute(sql`
        SELECT quality::text AS quality, budget_fit, location_fit, timeline_fit,
               configuration_fit, budget_min, budget_max, desired_configuration,
               purchase_intent, purchase_timeline, funding_mode, is_decision_maker,
               notes, created_at
        FROM lead_qualifications WHERE lead_id = ${leadId}
        ORDER BY created_at DESC LIMIT 1
      `),
      db().execute(sql`
        SELECT a.id, a.rule, a.reason, a.created_at,
               previous.name AS from_user_name, next.name AS to_user_name
        FROM lead_assignments a
        LEFT JOIN users previous ON previous.id = a.from_user_id
        LEFT JOIN users next ON next.id = a.to_user_id
        WHERE a.org_id = ${orgId} AND a.lead_id = ${leadId}
        ORDER BY a.created_at ASC
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
    assignments: assignmentsRes.rows as any[],
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
           t.attribution_expires_at AS "attributionExpiresAt",
           -- Site visits already on the books, so the board can offer to book
           -- "a 3rd site visit" rather than pretending each one is the first.
           -- Cancelled ones are excluded: a visit that was called off is not
           -- history, it is a visit that never existed.
           (SELECT COUNT(*)::int FROM visits v
             WHERE v.org_id = l.org_id AND v.lead_id = l.id
               AND v.type = 'project_site' AND v.status <> 'cancelled'
           ) AS "siteVisitCount",
           -- A self-service check-in leaves the lead in the new stage, so the
           -- board would otherwise show the person who drove to the site
           -- exactly like the one who filled a web form at midnight. The most
           -- recent arrival, and the channel it came through, ride along so the
           -- card can say which is which.
           arrival.arrived_at AS "arrivedAt",
           arrival.link_label AS "arrivedVia"
    FROM leads l
    JOIN persons p ON p.id = l.person_id
    LEFT JOIN users u ON u.id = l.owner_user_id
    LEFT JOIN lead_touchpoints t ON t.id = l.first_touchpoint_id
    LEFT JOIN LATERAL (
      SELECT v.arrived_at, wl.label AS link_label
      FROM visits v
      LEFT JOIN walk_in_links wl ON wl.id = v.walk_in_link_id AND wl.org_id = v.org_id
      WHERE v.org_id = l.org_id AND v.lead_id = l.id
        AND v.arrived_at IS NOT NULL AND v.status <> 'cancelled'
      ORDER BY v.arrived_at DESC
      LIMIT 1
    ) arrival ON true
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY l.score DESC, l.created_at DESC
    LIMIT 400
  `);
  return result.rows as unknown as (LeadRow & {
    attributionExpiresAt: string | null;
    siteVisitCount: number;
    arrivedAt: string | null;
    arrivedVia: string | null;
  })[];
}

/** Walk-in lookup. Phone is the only identifier a receptionist reliably has. */
export async function searchForCheckIn(orgId: string, query: string, ownerId?: string) {
  const digits = query.replace(/\D/g, "");
  if (digits.length < 4 && query.trim().length < 3) return [];

  const term = `%${digits.length >= 4 ? digits.slice(-10) : query.trim()}%`;

  const result = await db().execute(sql`
    SELECT l.id, l.reference, l.stage::text AS stage, l.project_id AS "projectId",
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
      ${ownerId ? sql`AND l.owner_user_id = ${ownerId}` : sql``}
      AND (p.primary_phone ILIKE ${term} OR p.full_name ILIKE ${term} OR l.reference ILIKE ${term})
      AND l.stage NOT IN ('lost','disqualified')
    ORDER BY l.created_at DESC
    LIMIT 10
  `);
  return result.rows as unknown as {
    id: string; reference: string; stage: string; projectId: string | null; fullName: string | null;
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
    lead_facts AS (
      SELECT t.ad_platform AS platform, t.campaign_id, MAX(t.campaign_name) AS campaign_name,
             l.id AS lead_id,
             EXISTS (
               SELECT 1 FROM lead_stage_history h
               WHERE h.org_id = l.org_id AND h.lead_id = l.id AND h.to_stage = 'qualified'
             ) AS reached_qualified,
             EXISTS (
               SELECT 1 FROM visits v
               WHERE v.org_id = l.org_id AND v.lead_id = l.id
                 AND v.type = 'project_site' AND v.arrived_at IS NOT NULL
             ) AS reached_visited,
             EXISTS (
               SELECT 1 FROM bookings b
               WHERE b.org_id = l.org_id AND b.lead_id = l.id AND b.status <> 'cancelled'
             ) AS reached_booked
      FROM leads l
      JOIN lead_touchpoints t ON t.id = l.first_touchpoint_id
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
      FROM lead_facts GROUP BY platform, campaign_id
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
    WHERE org_id = ${orgId} AND is_active = true
      AND role IN ('owner', 'admin', 'sales_manager', 'sales_agent', 'receptionist')
    ORDER BY name
  `);
  return result.rows as unknown as { id: string; name: string; role: string }[];
}

export async function listActiveProjects(orgId: string) {
  const result = await db().execute(sql`
    SELECT id, name FROM projects
    WHERE org_id = ${orgId} AND is_active = true
    ORDER BY name
  `);
  return result.rows as unknown as { id: string; name: string }[];
}

/** Per-agent performance. Stops marketing being blamed for a lead nobody rang. */
export async function getAgentPerformance(orgId: string, days = 30) {
  const result = await db().execute(sql`
    SELECT u.id, u.name,
      COUNT(l.id)::int AS leads,
      COUNT(l.id) FILTER (WHERE l.first_contacted_at IS NOT NULL)::int AS contacted,
      COUNT(l.id) FILTER (WHERE EXISTS (
        SELECT 1 FROM visits v
        WHERE v.org_id = l.org_id AND v.lead_id = l.id AND v.arrived_at IS NOT NULL
      ))::int AS visits,
      COUNT(l.id) FILTER (WHERE EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.org_id = l.org_id AND b.lead_id = l.id AND b.status <> 'cancelled'
      ))::int AS bookings,
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
