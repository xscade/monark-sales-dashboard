import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { consentState, identifierType, leadQuality } from "./enums";
import { orgs, users } from "./org";

/**
 * A resolved human being.
 *
 * The critical modelling decision in this whole system: a person is NOT a lead.
 * Ravi may fill a Meta form in March, a Google landing page in May, WhatsApp in
 * June, and walk in during July. That is one person and (probably) one buying
 * journey — but four touchpoints and possibly two separate opportunities if he
 * enquires about two different projects.
 *
 * Collapsing these into "one lead row that gets overwritten" is how CRMs
 * destroy attribution: the source column ends up saying whatever happened last,
 * and the campaign that actually created the demand gets no credit.
 */
export const persons = pgTable(
  "persons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    fullName: text("full_name"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    /** Display-only. Matching always goes through personIdentifiers. */
    primaryPhone: text("primary_phone"),
    primaryEmail: text("primary_email"),
    city: text("city"),
    state: text("state"),
    postalCode: text("postal_code"),
    countryCode: text("country_code").notNull().default("IN"),
    /** NRI buyers behave differently (longer cycles, virtual visits, different
     *  creative). Worth a first-class flag rather than a tag. */
    isNri: boolean("is_nri").notNull().default(false),
    preferredLanguage: text("preferred_language"),
    /** Set when this person has been merged INTO another. Reads follow the
     *  pointer; we never delete, so a bad merge is always reversible. */
    mergedIntoPersonId: uuid("merged_into_person_id"),
    /** Do-not-contact. Also hard-blocks outbound conversion delivery. */
    isSuppressed: boolean("is_suppressed").notNull().default(false),
    suppressionReason: text("suppression_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("persons_org_idx").on(t.orgId),
    index("persons_merged_into_idx").on(t.mergedIntoPersonId),
    index("persons_primary_phone_idx").on(t.orgId, t.primaryPhone),
  ],
);

/**
 * The matching index. One row per (person, identifier).
 *
 * `valueNormalized` is the canonical form we match on — E.164 for phones,
 * lowercased+trimmed for email. `valueHash` is the SHA-256 the ad platforms
 * want; we precompute it so the outbox worker never has to touch raw PII and
 * hashing rules live in exactly one place.
 *
 * The unique constraint on (org, type, valueNormalized) is what actually
 * enforces deduplication, at the database level, under concurrency. Two
 * simultaneous form submissions from the same phone cannot create two people.
 */
export const personIdentifiers = pgTable(
  "person_identifiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    type: identifierType("type").notNull(),
    valueNormalized: text("value_normalized").notNull(),
    /** SHA-256 hex of the normalized value, per platform hashing rules. */
    valueHash: text("value_hash").notNull(),
    /** What we received before normalization — kept for debugging bad inputs. */
    valueRaw: text("value_raw"),
    isVerified: boolean("is_verified").notNull().default(false),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("person_identifiers_unique_idx").on(t.orgId, t.type, t.valueNormalized),
    index("person_identifiers_person_idx").on(t.personId),
    index("person_identifiers_hash_idx").on(t.valueHash),
  ],
);

/**
 * Merge audit. Every merge is recorded with enough detail to undo it.
 *
 * Identity resolution gets things wrong — shared family phone numbers, a
 * receptionist's number entered for three different buyers, typo'd emails. An
 * irreversible merge silently corrupts both the sales history and the
 * conversion signal, so reversibility is a requirement rather than a nicety.
 */
export const personMerges = pgTable(
  "person_merges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    survivingPersonId: uuid("surviving_person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    mergedPersonId: uuid("merged_person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    /** 'exact_phone' | 'exact_email' | 'manual' | 'fuzzy_name_phone' */
    matchRule: text("match_rule").notNull(),
    confidence: text("confidence").notNull().default("1.0"),
    /** Full snapshot of the merged record, so an unmerge can restore it. */
    mergedSnapshot: jsonb("merged_snapshot").notNull(),
    performedByUserId: uuid("performed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    revertedAt: timestamp("reverted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("person_merges_surviving_idx").on(t.survivingPersonId),
    index("person_merges_merged_idx").on(t.mergedPersonId),
  ],
);

/**
 * Append-only consent ledger.
 *
 * We are shipping first-party customer data to two American ad platforms. Under
 * India's DPDP Act that requires a demonstrable lawful basis, and both Meta and
 * Google contractually require you to have obtained consent. "The checkbox was
 * ticked" is not defensible six months later unless you can produce the
 * timestamp, the policy version, and the surface it was collected on.
 *
 * Never UPDATE a consent row — withdrawal is a new row. The current state is
 * the latest row per (person, purpose).
 */
export const consentRecords = pgTable(
  "consent_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    /** 'marketing_contact' | 'ad_user_data' | 'ad_personalization' | 'whatsapp' */
    purpose: text("purpose").notNull(),
    state: consentState("state").notNull(),
    /** Where it was collected: form URL, "walk-in paper form", "IVR keypress". */
    collectedVia: text("collected_via").notNull(),
    policyVersion: text("policy_version"),
    /** Truncated to /24 (IPv4) before storage — enough for dispute resolution,
     *  not enough to be a tracking identifier in its own right. */
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    evidence: jsonb("evidence"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("consent_person_purpose_idx").on(t.personId, t.purpose, t.createdAt),
    index("consent_org_idx").on(t.orgId),
  ],
);

/**
 * Structured qualification captured on the first real conversation.
 *
 * This is the highest-leverage data in the system and the easiest to skip.
 * A campaign's true worth is not its cost per form fill, it is the share of
 * its leads that a salesperson rates as genuinely qualified — and you can only
 * learn that if the rating is a structured field rather than a free-text note.
 */
export const leadQualifications = pgTable(
  "lead_qualifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").notNull(),
    quality: leadQuality("quality").notNull().default("unrated"),
    budgetFit: boolean("budget_fit"),
    locationFit: boolean("location_fit"),
    timelineFit: boolean("timeline_fit"),
    configurationFit: boolean("configuration_fit"),
    isDecisionMaker: boolean("is_decision_maker"),
    budgetMin: text("budget_min"),
    budgetMax: text("budget_max"),
    /** '2bhk' | '3bhk' | '4bhk' | 'penthouse' | 'villa' */
    desiredConfiguration: text("desired_configuration"),
    purchaseIntent: text("purchase_intent"), // end_use | investment | undecided
    /** 'immediate' | '3_months' | '6_months' | '12_months' | 'exploring' */
    purchaseTimeline: text("purchase_timeline"),
    fundingMode: text("funding_mode"), // self | home_loan | mixed
    notes: text("notes"),
    ratedByUserId: uuid("rated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lead_qualifications_lead_idx").on(t.leadId, t.createdAt)],
);
