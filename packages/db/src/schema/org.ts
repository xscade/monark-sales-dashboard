import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { userRole } from "./enums";

/**
 * Multi-tenancy is present from day one even though Monark is the only tenant.
 * Retrofitting an org_id onto a CRM that already holds live customer data is a
 * genuinely miserable migration; carrying the column now costs nothing.
 */
export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /** IANA timezone. All display formatting derives from this; storage is UTC. */
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  currency: text("currency").notNull().default("INR"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    city: text("city"),
    /** RERA registration number — legally required on Indian real-estate
     *  marketing collateral, so it belongs next to the project, not in a doc. */
    reraNumber: text("rera_number"),
    /** Expected gross value of an average sale, in org currency. Feeds the
     *  conversion value model; without it we cannot compute expected value. */
    avgSaleValue: text("avg_sale_value"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("projects_org_slug_idx").on(t.orgId, t.slug)],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    role: userRole("role").notNull().default("sales_agent"),
    passwordHash: text("password_hash"),
    /** Languages the agent can sell in. Routing uses this — a Telugu-only
     *  enquiry handed to an English-only agent is a lost lead. */
    languages: jsonb("languages").$type<string[]>().notNull().default([]),
    /** Max open leads before the assignment engine stops routing to them. */
    leadCapacity: text("lead_capacity").notNull().default("150"),
    isActive: boolean("is_active").notNull().default(true),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_org_email_idx").on(t.orgId, t.email)],
);

/**
 * API keys for inbound ingestion. We store only a hash of the secret; the
 * plaintext is shown once at creation. Each key carries its own HMAC signing
 * secret so a leaked key cannot be replayed against a different tenant.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Public, non-secret prefix used to look the key up: `mk_live_a1b2c3`. */
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    /** Shared secret for HMAC request signing. Encrypted at rest. */
    signingSecretEncrypted: text("signing_secret_encrypted").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default(["leads:write"]),
    /** Restrict a key to one project — useful when handing a key to an agency. */
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    /** Browser keys can use bearer auth only. Server keys must also provide a
     *  valid HMAC signature for every request. */
    keyPolicy: text("key_policy").$type<"browser" | "server">().notNull().default("browser"),
    signatureRequired: boolean("signature_required").notNull().default(false),
    rateLimitPerMinute: text("rate_limit_per_minute").notNull().default("120"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("api_keys_prefix_idx").on(t.keyPrefix),
    index("api_keys_org_idx").on(t.orgId),
    check(
      "api_keys_policy_signature_check",
      sql`(${t.keyPolicy} = 'browser' AND ${t.signatureRequired} = false)
          OR (${t.keyPolicy} = 'server' AND ${t.signatureRequired} = true)`,
    ),
  ],
);

/**
 * Database-backed fixed-window buckets for public API throttling.
 *
 * The old process-local Map multiplied the effective rate limit by the number
 * of Vercel instances. A composite primary key gives every replica one atomic
 * counter for a key/minute instead.
 */
export const apiRateLimitBuckets = pgTable(
  "api_rate_limit_buckets",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    apiKeyId: uuid("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    requestCount: integer("request_count").notNull().default(0),
  },
  (t) => [
    primaryKey({
      name: "api_rate_limit_buckets_pk",
      columns: [t.apiKeyId, t.windowStart],
    }),
    index("api_rate_limit_buckets_org_window_idx").on(t.orgId, t.windowStart),
    check("api_rate_limit_buckets_count_check", sql`${t.requestCount} >= 0`),
  ],
);

/**
 * Idempotency ledger for the public ingestion API.
 *
 * A website form that retries on a flaky connection must not create five
 * leads. We persist the original response so a replay returns byte-identical
 * output rather than a second insert.
 */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    endpoint: text("endpoint").notNull(),
    /** Hash of the request body — a same-key/different-body replay is a bug on
     *  the caller's side and must be rejected loudly, not silently merged. */
    requestHash: text("request_hash").notNull(),
    responseStatus: text("response_status").notNull(),
    responseBody: jsonb("response_body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("idempotency_org_key_endpoint_idx").on(t.orgId, t.key, t.endpoint),
    index("idempotency_expires_idx").on(t.expiresAt),
  ],
);

/**
 * Append-only audit trail. Anything touching money (token, booking, refund),
 * consent, or an integration credential must land here.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorType: text("actor_type").notNull().default("user"), // user | api_key | system | worker
    action: text("action").notNull(), // lead.stage_changed, booking.created, ...
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_org_created_idx").on(t.orgId, t.createdAt),
    index("audit_entity_idx").on(t.entityType, t.entityId),
  ],
);
