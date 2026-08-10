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
import { unitStatus, visitStatus, visitType } from "./enums";
import { orgs, projects, users } from "./org";
import { leads } from "./leads";
import { persons } from "./identity";

/**
 * Walk-ins and site visits, unified.
 *
 * These were separate concepts in the original design; they are the same event
 * with a different location, and splitting them means every funnel query has to
 * UNION two tables forever.
 *
 * What must NOT be collapsed is scheduled vs. arrived. "Booked an appointment"
 * and "physically turned up at a site office 40 minutes out of town" are wildly
 * different intent signals, and sending them to Meta as one event throws away
 * the most valuable offline signal this business has. Hence separate timestamps
 * with `arrivedAt` as the thing that actually fires a conversion.
 */
export const visits = pgTable(
  "visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),

    type: visitType("type").notNull(),
    status: visitStatus("status").notNull().default("scheduled"),

    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    /** The moment that matters. Set by the check-in button or a QR scan. */
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    departedAt: timestamp("departed_at", { withTimezone: true }),
    durationMinutes: integer("duration_minutes"),

    hostUserId: uuid("host_user_id").references(() => users.id, { onDelete: "set null" }),

    /** Family size on site is a strong buying signal in this segment — a buyer
     *  who brings parents and spouse to a site visit is materially closer to a
     *  decision than one who comes alone. */
    accompanyingCount: integer("accompanying_count").notNull().default(0),
    accompanyingRelations: jsonb("accompanying_relations").$type<string[]>(),

    configurationsViewed: jsonb("configurations_viewed").$type<string[]>(),
    unitsViewed: jsonb("units_viewed").$type<string[]>(),
    /** 1-5, captured by the host immediately after. Degrades fast if deferred. */
    intentRating: integer("intent_rating"),
    objections: jsonb("objections").$type<string[]>(),
    nextAction: text("next_action"),
    notes: text("notes"),

    /** Check-in method, for auditing self-reported visits. A QR scan at the
     *  site office is trustworthy; a manual entry three days later is not, and
     *  we should not feed the latter to ad platforms with equal confidence. */
    checkInMethod: text("check_in_method").notNull().default("manual"), // manual | qr | geofence
    checkInLatitude: numeric("check_in_latitude", { precision: 10, scale: 7 }),
    checkInLongitude: numeric("check_in_longitude", { precision: 10, scale: 7 }),

    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("visits_lead_idx").on(t.leadId, t.scheduledAt),
    index("visits_org_arrived_idx").on(t.orgId, t.arrivedAt),
    index("visits_org_scheduled_idx").on(t.orgId, t.scheduledAt, t.status),
    index("visits_host_idx").on(t.hostUserId),
  ],
);

/** Sellable inventory. Needed for real shortlisting and to stop two agents
 *  selling the same flat on the same afternoon. */
export const units = pgTable(
  "units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tower: text("tower"),
    unitNumber: text("unit_number").notNull(),
    floor: integer("floor"),
    configuration: text("configuration").notNull(), // 3bhk | 4bhk | penthouse
    carpetAreaSqft: numeric("carpet_area_sqft", { precision: 10, scale: 2 }),
    saleableAreaSqft: numeric("saleable_area_sqft", { precision: 10, scale: 2 }),
    facing: text("facing"),
    basePrice: numeric("base_price", { precision: 14, scale: 2 }),
    allInPrice: numeric("all_in_price", { precision: 14, scale: 2 }),
    status: unitStatus("status").notNull().default("available"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("units_project_number_idx").on(t.projectId, t.tower, t.unitNumber),
    index("units_status_idx").on(t.orgId, t.projectId, t.status),
  ],
);

/**
 * Soft holds with an expiry. Without a TTL, holds are never released and the
 * availability board becomes fiction within a month.
 */
export const unitHolds = pgTable(
  "unit_holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    heldByUserId: uuid("held_by_user_id").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releaseReason: text("release_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("unit_holds_unit_idx").on(t.unitId, t.releasedAt),
    index("unit_holds_expiry_idx").on(t.orgId, t.expiresAt, t.releasedAt),
  ],
);

/** Which units a lead is actually considering — the signal behind the
 *  `unit_shortlisted` conversion event. */
export const unitInterests = pgTable(
  "unit_interests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    rank: integer("rank"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("unit_interests_unique_idx").on(t.leadId, t.unitId)],
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    reference: text("reference").notNull(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").references(() => units.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),

    /** token | booked | agreement_signed | registered | cancelled */
    status: text("status").notNull().default("token"),
    agreementValue: numeric("agreement_value", { precision: 14, scale: 2 }),
    tokenAmount: numeric("token_amount", { precision: 14, scale: 2 }),
    tokenPaidAt: timestamp("token_paid_at", { withTimezone: true }),
    bookedAt: timestamp("booked_at", { withTimezone: true }),
    agreementSignedAt: timestamp("agreement_signed_at", { withTimezone: true }),
    registeredAt: timestamp("registered_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),

    /** Attributed to whoever owned the lead at booking time, snapshotted so a
     *  later reassignment does not rewrite commission history. */
    closedByUserId: uuid("closed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("bookings_org_reference_idx").on(t.orgId, t.reference),
    index("bookings_lead_idx").on(t.leadId),
    index("bookings_org_status_idx").on(t.orgId, t.status, t.bookedAt),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    /** token | booking_amount | instalment | registration | refund */
    kind: text("kind").notNull(),
    mode: text("mode"), // upi | neft | cheque | card | cash
    reference: text("reference"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    isReversed: boolean("is_reversed").notNull().default(false),
    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payments_booking_idx").on(t.bookingId, t.receivedAt)],
);
