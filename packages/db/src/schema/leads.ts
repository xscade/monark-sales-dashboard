import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  leadStage,
  leadSubStatus,
  lostReason,
  touchpointSource,
} from "./enums";
import { orgs, projects, users } from "./org";
import { persons } from "./identity";

/**
 * An opportunity: one person's interest in one project.
 *
 * Kept separate from `persons` so a buyer enquiring about two projects has two
 * pipelines, and a buyer who goes cold and returns a year later gets a fresh
 * opportunity without erasing the first one's history.
 */
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    /** Human-facing reference: LD-2026-008321. Salespeople quote this on calls. */
    reference: text("reference").notNull(),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),

    stage: leadStage("stage").notNull().default("new"),
    subStatus: leadSubStatus("sub_status").notNull().default("none"),
    lostReason: lostReason("lost_reason"),
    lostNotes: text("lost_notes"),

    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),

    /**
     * Denormalised pointer to the touchpoint that CREATED this opportunity.
     * First-touch attribution reads from here; it is never overwritten.
     */
    firstTouchpointId: uuid("first_touchpoint_id"),
    /** Most recent touchpoint. Updated on every new inbound signal. */
    lastTouchpointId: uuid("last_touchpoint_id"),

    /**
     * Model-scored, 0-100. Blends qualification fields, engagement recency,
     * source quality and stage. Used for work prioritisation, never for
     * automatically discarding a lead.
     */
    score: integer("score").notNull().default(0),
    scoreUpdatedAt: timestamp("score_updated_at", { withTimezone: true }),

    /**
     * Speed-to-lead is the single strongest predictor of conversion in
     * real estate. Materialised here rather than computed on the fly so it can
     * be indexed, alerted on, and charted per agent without a self-join.
     */
    firstContactedAt: timestamp("first_contacted_at", { withTimezone: true }),
    firstResponseSeconds: integer("first_response_seconds"),
    slaBreachedAt: timestamp("sla_breached_at", { withTimezone: true }),

    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),

    /**
     * Excludes the lead from every outbound conversion delivery. Set by the
     * spam heuristics, by a manual "junk" mark, or by QA test submissions.
     * Feeding fake conversions to Meta and Google actively degrades bidding —
     * this gate matters more than it looks.
     */
    isTest: boolean("is_test").notNull().default(false),
    spamScore: integer("spam_score").notNull().default(0),

    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("leads_org_reference_idx").on(t.orgId, t.reference),
    index("leads_org_stage_idx").on(t.orgId, t.stage),
    index("leads_owner_idx").on(t.ownerUserId, t.stage),
    index("leads_person_idx").on(t.personId),
    index("leads_project_idx").on(t.projectId),
    index("leads_follow_up_idx").on(t.orgId, t.nextFollowUpAt),
    index("leads_created_idx").on(t.orgId, t.createdAt),
  ],
);

/**
 * Every inbound signal, append-only, with a complete attribution snapshot
 * frozen at the moment of capture.
 *
 * This table is the reason the platform can answer "which creative sold the
 * 4BHK?". Click identifiers are unrecoverable after the fact — if the GCLID
 * is not captured in the same request as the form submission, that conversion
 * can never be attributed, ever. There is no backfill.
 */
export const leadTouchpoints = pgTable(
  "lead_touchpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),

    source: touchpointSource("source").notNull(),
    /** Free-form sub-source: '99acres', 'insta_bio_link', 'hoarding_qr_nh16'. */
    sourceDetail: text("source_detail"),

    // --- UTM ---------------------------------------------------------------
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmContent: text("utm_content"),
    utmTerm: text("utm_term"),
    utmId: text("utm_id"),

    // --- Click identifiers -------------------------------------------------
    // Capture-or-lose-forever. All are nullable because any given visit will
    // only ever carry one platform's identifier.
    gclid: text("gclid"),
    /** iOS/app-to-web Google click IDs. Increasingly common; omitting them
     *  silently loses a growing slice of Google attribution. */
    gbraid: text("gbraid"),
    wbraid: text("wbraid"),
    fbclid: text("fbclid"),
    /** Meta browser cookies. `fbc` is derived from fbclid; `fbp` is the browser
     *  ID. Sending both materially raises Event Match Quality. */
    fbp: text("fbp"),
    fbc: text("fbc"),
    /**
     * Click-to-WhatsApp ad click ID. In this market WhatsApp is frequently the
     * highest-volume ad destination, and CTWA leads are invisible to a CRM that
     * only knows about fbclid. Capturing this closes a large attribution hole.
     */
    ctwaClid: text("ctwa_clid"),
    /** Meta Lead Ads leadgen id — the join key for the Lead Ads webhook. */
    metaLeadId: text("meta_lead_id"),
    msclkid: text("msclkid"),
    liFatId: text("li_fat_id"),

    // --- Resolved ad hierarchy (backfilled from platform reporting APIs) ----
    adPlatform: text("ad_platform"), // meta | google | bing | linkedin
    campaignId: text("campaign_id"),
    campaignName: text("campaign_name"),
    adsetId: text("adset_id"),
    adsetName: text("adset_name"),
    adId: text("ad_id"),
    adName: text("ad_name"),
    creativeId: text("creative_id"),
    creativeName: text("creative_name"),
    keyword: text("keyword"),
    matchType: text("match_type"),
    placement: text("placement"),

    // --- Page context ------------------------------------------------------
    landingPage: text("landing_page"),
    referrer: text("referrer"),
    userAgent: text("user_agent"),
    /** Truncated before storage. Meta accepts client IP for match quality; we
     *  keep only what is needed and never expose it in the UI. */
    ipAddress: text("ip_address"),

    /**
     * Browser-generated event id, shared with the Meta Pixel's client-side
     * `Lead` event.
     *
     * Without this, the pixel fires Lead in the browser AND the CRM fires Lead
     * via CAPI, and Meta counts two conversions for one enquiry — inflating
     * reported performance and corrupting bid optimisation. Same id on both
     * sides is the only reliable dedup mechanism.
     */
    browserEventId: text("browser_event_id"),

    /**
     * When the ad click actually happened, if known. Falls back to receipt time.
     * The attribution clock runs from THIS, not from when the CRM saw the lead.
     */
    clickedAt: timestamp("clicked_at", { withTimezone: true }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),

    /**
     * Hard deadline after which Google will no longer attribute an offline
     * conversion tied to this click. Google expires GCLIDs 90 days after the
     * click and silently drops later uploads.
     *
     * A ₹3 crore apartment routinely takes longer than 90 days to close, so a
     * meaningful share of BOOKINGS will land after this timestamp and can never
     * be attributed. That single fact drives the platform's core strategy:
     * optimise ad delivery on mid-funnel events that reliably occur inside the
     * window (qualified, site visit), and treat bookings as measurement plus
     * value calibration rather than as the bidding signal.
     *
     * Surfacing this per lead lets sales see a real countdown, and lets us
     * report exactly how much attribution the sales cycle is costing us.
     */
    attributionExpiresAt: timestamp("attribution_expires_at", { withTimezone: true }),

    rawPayload: jsonb("raw_payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("touchpoints_person_idx").on(t.personId, t.occurredAt),
    index("touchpoints_lead_idx").on(t.leadId, t.occurredAt),
    index("touchpoints_org_occurred_idx").on(t.orgId, t.occurredAt),
    index("touchpoints_gclid_idx").on(t.gclid),
    index("touchpoints_meta_lead_idx").on(t.metaLeadId),
    index("touchpoints_campaign_idx").on(t.orgId, t.adPlatform, t.campaignId),
    index("touchpoints_expiry_idx").on(t.orgId, t.attributionExpiresAt),
  ],
);

/**
 * Append-only stage ledger. The `leads.stage` column is a cache of the newest
 * row here.
 *
 * Overwriting a status column destroys the funnel: you can no longer compute
 * how long a lead sat in "qualified", how many leads regressed, or what the
 * true stage-to-stage conversion rate is — which is exactly the input the
 * conversion value model needs.
 */
export const leadStageHistory = pgTable(
  "lead_stage_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    fromStage: leadStage("from_stage"),
    toStage: leadStage("to_stage").notNull(),
    /** Seconds spent in fromStage. Precomputed for cycle-time reporting. */
    durationInPreviousSeconds: integer("duration_in_previous_seconds"),
    changedByUserId: uuid("changed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** 'user' | 'automation' | 'api' | 'import' */
    changedBy: text("changed_by").notNull().default("user"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("stage_history_lead_idx").on(t.leadId, t.createdAt),
    index("stage_history_org_to_idx").on(t.orgId, t.toStage, t.createdAt),
  ],
);

/** Append-only ownership ledger — needed to attribute outcomes to the agent who
 *  actually did the work, not whoever happens to own the lead today. */
export const leadAssignments = pgTable(
  "lead_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    fromUserId: uuid("from_user_id").references(() => users.id, { onDelete: "set null" }),
    toUserId: uuid("to_user_id").references(() => users.id, { onDelete: "set null" }),
    /** 'round_robin' | 'language_match' | 'manual' | 'escalation' | 'reassign_idle' */
    rule: text("rule").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("assignments_lead_idx").on(t.leadId, t.createdAt)],
);

/**
 * Unified activity stream — calls, WhatsApp, email, notes, tasks, system
 * events. Powers the lead timeline, which in practice becomes the most-used
 * screen in the product.
 */
export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    personId: uuid("person_id").references(() => persons.id, { onDelete: "cascade" }),
    /** call | whatsapp | email | sms | note | task | meeting | system */
    type: text("type").notNull(),
    direction: text("direction"), // inbound | outbound
    subject: text("subject"),
    body: text("body"),

    // --- Telephony ---------------------------------------------------------
    callDurationSeconds: integer("call_duration_seconds"),
    callOutcome: text("call_outcome"), // connected | no_answer | busy | invalid | switched_off
    callRecordingUrl: text("call_recording_url"),
    /** Transcript + AI-extracted signals (objections, budget mentions, intent).
     *  Populated asynchronously; absence must never block the timeline. */
    transcript: text("transcript"),
    aiInsights: jsonb("ai_insights"),

    // --- Task fields -------------------------------------------------------
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    metadata: jsonb("metadata"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activities_lead_idx").on(t.leadId, t.occurredAt),
    index("activities_person_idx").on(t.personId, t.occurredAt),
    index("activities_due_idx").on(t.orgId, t.dueAt),
    index("activities_user_idx").on(t.userId, t.occurredAt),
  ],
);

/**
 * Daily ad spend, pulled from Meta Insights and Google Ads reporting.
 *
 * Without spend in the same database as outcomes, the dashboard can only show
 * cost per lead — the metric that makes cheap, worthless leads look good.
 * Joining spend to stage outcomes is what produces cost-per-site-visit and
 * cost-per-booking, which is where the real decisions get made.
 */
export const adSpendDaily = pgTable(
  "ad_spend_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // YYYY-MM-DD in org timezone
    platform: text("platform").notNull(),
    campaignId: text("campaign_id").notNull(),
    campaignName: text("campaign_name"),
    adsetId: text("adset_id"),
    adsetName: text("adset_name"),
    adId: text("ad_id"),
    adName: text("ad_name"),
    spend: numeric("spend", { precision: 14, scale: 2 }).notNull().default("0"),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    /** What the platform *thinks* it drove — kept to diff against our truth. */
    platformReportedConversions: numeric("platform_reported_conversions", {
      precision: 12,
      scale: 2,
    }).notNull().default("0"),
    currency: text("currency").notNull().default("INR"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ad_spend_unique_idx").on(
      t.orgId,
      t.platform,
      t.date,
      t.campaignId,
      t.adsetId,
      t.adId,
    ),
    index("ad_spend_date_idx").on(t.orgId, t.date),
  ],
);
