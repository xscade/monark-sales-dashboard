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
  conversionEventType,
  deliveryStatus,
  destinationPlatform,
  leadStage,
} from "./enums";
import { orgs, projects } from "./org";
import { leads, leadTouchpoints } from "./leads";
import { persons } from "./identity";

/**
 * A configured downstream destination — one Meta dataset, or one Google
 * operating account.
 *
 * Credentials are encrypted at rest with AES-256-GCM. They are never returned
 * to the browser, and the worker decrypts them in memory only.
 */
export const conversionDestinations = pgTable(
  "conversion_destinations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    platform: destinationPlatform("platform").notNull(),
    name: text("name").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(false),

    /**
     * Start every destination in dry-run. Payloads are built, validated and
     * logged in full, but nothing is recorded by the platform. There is no way
     * to un-send a bad conversion, and a week of malformed events can degrade
     * Smart Bidding for longer than it takes to notice, so the safe default is
     * mandatory rather than advisory.
     */
    dryRun: boolean("dry_run").notNull().default(true),

    /**
     * Platform-specific config, shape validated by the adapter:
     *   meta_capi          → { datasetId, apiVersion, testEventCode? }
     *   google_data_manager→ { operatingAccountId, loginAccountId?,
     *                          productDestinationId, accountType }
     */
    config: jsonb("config").notNull(),
    credentialsEncrypted: text("credentials_encrypted"),

    /** Scope a destination to one project so campaigns for different towers
     *  don't cross-contaminate each other's optimisation signals. */
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),

    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("destinations_org_platform_idx").on(t.orgId, t.platform, t.isEnabled)],
);

/**
 * Internal event → platform event mapping. Editable without a deploy.
 *
 * This indirection is the whole reason business logic never imports Meta's
 * vocabulary. When Meta renames an event, or you decide site visits should map
 * to `Schedule` instead of a custom event, it is one row.
 */
export const conversionEventMappings = pgTable(
  "conversion_event_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    destinationId: uuid("destination_id")
      .notNull()
      .references(() => conversionDestinations.id, { onDelete: "cascade" }),
    eventType: conversionEventType("event_type").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),

    /** Meta: 'Lead' | 'Purchase' | 'MonarkSiteVisit'.
     *  Google: the conversion action / productDestinationId to route to. */
    platformEventName: text("platform_event_name").notNull(),
    platformDestinationId: text("platform_destination_id"),

    /**
     * How to price this event:
     *   'none'     → send no value
     *   'fixed'    → send fixedValue
     *   'modelled' → P(booking | stage) × project average sale value
     *   'actual'   → the real transaction amount (bookings only)
     */
    valueStrategy: text("value_strategy").notNull().default("modelled"),
    fixedValue: numeric("fixed_value", { precision: 14, scale: 2 }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("event_mappings_unique_idx").on(t.destinationId, t.eventType),
    index("event_mappings_org_idx").on(t.orgId),
  ],
);

/**
 * The transactional outbox.
 *
 * Business code writes a row here in the SAME transaction that changes the
 * lead. It never calls Meta or Google inline. An ad platform being slow, rate
 * limiting us, or returning a 500 must never make a salesperson's "check in"
 * button spin — and conversely, a successful UI action must never be silently
 * lost because an HTTP call failed after the commit.
 */
export const conversionEvents = pgTable(
  "conversion_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    eventType: conversionEventType("event_type").notNull(),

    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    /** Attribution source of truth for this event. Pinned at emission so a
     *  later touchpoint cannot retroactively change what we already reported. */
    touchpointId: uuid("touchpoint_id").references(() => leadTouchpoints.id, {
      onDelete: "set null",
    }),

    /**
     * Stable, globally unique event id.
     *
     * Doubles as Meta's `event_id` and Google's `transactionId`. For
     * `lead_created` we reuse the browser-generated id from the touchpoint so
     * the client-side Pixel event and this server-side event collapse into one
     * conversion instead of two.
     */
    eventKey: text("event_key").notNull(),

    /** When the real-world thing happened — NOT when we got around to sending
     *  it. Both platforms attribute on this. */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),

    value: numeric("value", { precision: 14, scale: 2 }),
    currency: text("currency").notNull().default("INR"),
    /** Which value model produced `value`, so historical sends stay explainable
     *  after the model is retrained. */
    valueModelVersion: integer("value_model_version"),

    stageAtEvent: leadStage("stage_at_event"),
    sourceEntityType: text("source_entity_type"), // visit | booking | lead | payment
    sourceEntityId: uuid("source_entity_id"),
    metadata: jsonb("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** Hard guarantee against double-emission: one event of a given type per
     *  lead per key. A double-clicked "check in" cannot produce two visits'
     *  worth of conversions. */
    uniqueIndex("conversion_events_key_idx").on(t.orgId, t.eventKey),
    index("conversion_events_lead_idx").on(t.leadId, t.occurredAt),
    index("conversion_events_org_type_idx").on(t.orgId, t.eventType, t.occurredAt),
  ],
);

/**
 * One row per (event, destination). This is what the worker actually drains.
 *
 * Modelled separately from the event because Meta can succeed while Google
 * fails, and each needs its own retry schedule and its own terminal state.
 */
export const conversionDeliveries = pgTable(
  "conversion_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    conversionEventId: uuid("conversion_event_id")
      .notNull()
      .references(() => conversionEvents.id, { onDelete: "cascade" }),
    destinationId: uuid("destination_id")
      .notNull()
      .references(() => conversionDestinations.id, { onDelete: "cascade" }),

    status: deliveryStatus("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    /** Exponential backoff target. The worker only picks up rows where this is
     *  in the past, which keeps retry scheduling in the database rather than in
     *  a fragile in-memory timer. */
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),

    /**
     * Deadline after which sending is pointless.
     *
     * Two independent clocks feed this, and we take the earlier:
     *  - Google drops offline conversions uploaded >90 days after the click.
     *  - Meta rejects an entire request if any `event_time` is >7 days old,
     *    so a delivery that has been stuck for a week is unrecoverable.
     *
     * Rows past this deadline become `expired`, not `failed`, so the "how much
     * attribution did the sales cycle cost us?" report is honest.
     */
    deliverBy: timestamp("deliver_by", { withTimezone: true }),

    /** Populated when the eligibility gate refuses to send, e.g.
     *  'consent_denied' | 'no_usable_identifier' | 'test_lead' | 'suppressed'. */
    ineligibleReason: text("ineligible_reason"),

    /** Exact payload sent, PII already hashed. Reproducing a platform support
     *  ticket without this is close to impossible. */
    requestPayload: jsonb("request_payload"),
    responseBody: jsonb("response_body"),
    lastError: text("last_error"),

    /** Meta's fbtrace_id / Google's request id, for support escalation. */
    platformTraceId: text("platform_trace_id"),
    /** Meta returns per-request match quality; tracking it over time is the
     *  only way to notice identifier coverage silently degrading. */
    matchQuality: numeric("match_quality", { precision: 5, scale: 2 }),

    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("deliveries_event_destination_idx").on(t.conversionEventId, t.destinationId),
    /** The worker's hot path: claim pending/retryable rows that are due. */
    index("deliveries_claim_idx").on(t.status, t.nextAttemptAt),
    index("deliveries_org_status_idx").on(t.orgId, t.status, t.createdAt),
  ],
);

/** Per-HTTP-attempt log. Separate from the delivery row so a retry never
 *  overwrites the evidence of why the previous attempt failed. */
export const conversionDeliveryAttempts = pgTable(
  "conversion_delivery_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => conversionDeliveries.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    httpStatus: integer("http_status"),
    durationMs: integer("duration_ms"),
    requestPayload: jsonb("request_payload"),
    responseBody: jsonb("response_body"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("delivery_attempts_delivery_idx").on(t.deliveryId, t.attemptNumber)],
);

/**
 * Versioned conversion value model.
 *
 * Assigning "walk-in = ₹100, booking = ₹10,000" out of thin air teaches the ad
 * platforms a fictional economy and produces confidently wrong bidding. This
 * table holds empirically derived stage→booking probabilities so the value sent
 * with each event is defensible.
 *
 * Volumes here are small — a few bookings a month, not e-commerce scale — so
 * the estimator shrinks observed rates toward a prior rather than trusting raw
 * ratios. `sampleSize` is stored alongside so the UI can be honest about how
 * much evidence a number actually rests on.
 */
export const valueModelVersions = pgTable(
  "value_model_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    isActive: boolean("is_active").notNull().default(false),
    /** 'prior' until there is enough history, then 'empirical_bayes'. */
    method: text("method").notNull().default("prior"),
    /** Lookback used to fit, in days. */
    windowDays: integer("window_days").notNull().default(365),
    expectedSaleValue: numeric("expected_sale_value", { precision: 14, scale: 2 }),
    notes: text("notes"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("value_model_version_idx").on(t.orgId, t.projectId, t.version),
    index("value_model_active_idx").on(t.orgId, t.isActive),
  ],
);

export const stageConversionRates = pgTable(
  "stage_conversion_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    valueModelVersionId: uuid("value_model_version_id")
      .notNull()
      .references(() => valueModelVersions.id, { onDelete: "cascade" }),
    stage: leadStage("stage").notNull(),
    /** P(reaches booked | reached this stage), shrunk toward the prior. */
    probabilityToBooking: numeric("probability_to_booking", { precision: 8, scale: 6 }).notNull(),
    /** Raw observed rate before shrinkage — kept for transparency. */
    observedRate: numeric("observed_rate", { precision: 8, scale: 6 }),
    sampleSize: integer("sample_size").notNull().default(0),
    /** probabilityToBooking × expectedSaleValue, precomputed. */
    expectedValue: numeric("expected_value", { precision: 14, scale: 2 }).notNull(),
    medianDaysToBooking: integer("median_days_to_booking"),
  },
  (t) => [uniqueIndex("stage_rates_unique_idx").on(t.valueModelVersionId, t.stage)],
);
