"use server";

import { randomUUID } from "node:crypto";
import { DEFAULT_STAGE_PRIORS, STAGE_ORDER, type ForwardStage, type LeadStage } from "@monark/core";
import { auditLogs, getDb, leadStageHistory, leads } from "@monark/db";
import { emitConversionEvent, eventKeyFor, type Tx } from "@monark/services";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "./auth";
import { localDateTimeSchema, parseLocalDateTime } from "./datetime";

const unitStatusSchema = z.enum([
  "available",
  "held",
  "token_paid",
  "booked",
  "registered",
  "blocked",
]);

const bookingStatusSchema = z.enum([
  "token",
  "booked",
  "agreement_signed",
  "registered",
  "cancelled",
]);

const optionalText = (max: number) =>
  z.preprocess(
    (value) => {
      const text = String(value ?? "").trim();
      return text || null;
    },
    z.string().max(max).nullable(),
  );

const optionalNumber = (max = Number.MAX_SAFE_INTEGER) =>
  z.preprocess(
    (value) => (value === "" || value == null ? null : Number(value)),
    z.number().finite().nonnegative().max(max).nullable(),
  );

const requiredNumber = (max = Number.MAX_SAFE_INTEGER) =>
  z.preprocess(
    (value) => Number(value),
    z.number().finite().positive().max(max),
  );

const optionalInteger = z.preprocess(
  (value) => (value === "" || value == null ? null : Number(value)),
  z.number().int().min(-100).max(500).nullable(),
);

const createUnitSchema = z.object({
  projectId: z.string().uuid(),
  tower: optionalText(80),
  unitNumber: z.string().trim().min(1).max(80),
  floor: optionalInteger,
  configuration: z.string().trim().min(1).max(80),
  carpetAreaSqft: optionalNumber(1_000_000),
  saleableAreaSqft: optionalNumber(1_000_000),
  facing: optionalText(80),
  basePrice: optionalNumber(1_000_000_000_000),
  allInPrice: optionalNumber(1_000_000_000_000),
});

const updateUnitSchema = createUnitSchema.omit({ projectId: true }).extend({
  unitId: z.string().uuid(),
});

const holdUnitSchema = z.object({
  unitId: z.string().uuid(),
  leadId: z.string().uuid(),
  hours: z.coerce.number().int().min(1).max(720).default(48),
  reason: optionalText(500),
});

const createBookingSchema = z
  .object({
    leadId: z.string().uuid(),
    unitId: z.string().uuid(),
    initialStatus: z.enum(["token", "booked"]).default("token"),
    agreementValue: optionalNumber(1_000_000_000_000),
    tokenAmount: requiredNumber(1_000_000_000_000),
    paymentMode: z.enum(["upi", "neft", "cheque", "card", "cash", "other"]),
    paymentReference: optionalText(160),
    receivedAt: z.preprocess(
      (value) => String(value ?? "").trim() || undefined,
      localDateTimeSchema.optional(),
    ),
  })
  .superRefine((value, context) => {
    if (value.initialStatus === "booked" && !value.agreementValue) {
      context.addIssue({
        code: "custom",
        path: ["agreementValue"],
        message: "Agreement value is required for a confirmed booking",
      });
    }
  });

const paymentSchema = z.object({
  paymentId: z.string().uuid(),
  bookingId: z.string().uuid(),
  amount: requiredNumber(1_000_000_000_000),
  kind: z.enum(["token", "booking_amount", "instalment", "registration", "refund"]),
  mode: z.enum(["upi", "neft", "cheque", "card", "cash", "other"]),
  reference: optionalText(160),
  receivedAt: z.preprocess(
    (value) => String(value ?? "").trim() || undefined,
    localDateTimeSchema.optional(),
  ),
});

const advanceBookingSchema = z.object({
  bookingId: z.string().uuid(),
  targetStatus: z.enum(["booked", "agreement_signed", "registered"]),
  agreementValue: optionalNumber(1_000_000_000_000),
});

interface UnitContext {
  id: string;
  projectId: string;
  status: z.infer<typeof unitStatusSchema>;
  unitNumber: string;
}

interface LeadContext {
  id: string;
  personId: string;
  projectId: string;
  ownerUserId: string | null;
  stage: LeadStage;
  isTest: boolean;
  createdAt: Date;
  updatedAt: Date;
  firstTouchpointId: string | null;
  attributionExpiresAt: Date | null;
}

interface BookingContext extends LeadContext {
  bookingId: string;
  bookingReference: string;
  bookingStatus: z.infer<typeof bookingStatusSchema>;
  unitId: string;
  agreementValue: string | null;
  tokenAmount: string | null;
  tokenPaidAt: Date | null;
  bookedAt: Date | null;
}

const decimal = (value: number | null): string | null =>
  value == null ? null : value.toFixed(2);

function revalidateCommercial(leadId?: string, bookingId?: string) {
  revalidatePath("/inventory");
  revalidatePath("/bookings");
  revalidatePath("/reports");
  revalidatePath("/pipeline");
  revalidatePath("/leads");
  if (leadId) revalidatePath(`/leads/${leadId}`);
  if (bookingId) revalidatePath(`/bookings/${bookingId}`);
}

async function assertProject(tx: Tx, orgId: string, projectId: string): Promise<void> {
  const result = await tx.execute(sql`
    SELECT id
    FROM projects
    WHERE org_id = ${orgId} AND id = ${projectId} AND is_active = true
    FOR SHARE
  `);
  if (!result.rows[0]) throw new Error("Project not found or inactive");
}

async function lockUnit(tx: Tx, orgId: string, unitId: string): Promise<UnitContext> {
  const result = await tx.execute(sql`
    SELECT u.id, u.project_id AS "projectId", u.status::text AS status,
           u.unit_number AS "unitNumber"
    FROM units u
    JOIN projects pr ON pr.id = u.project_id AND pr.org_id = u.org_id
    WHERE u.org_id = ${orgId} AND u.id = ${unitId}
    FOR UPDATE OF u
  `);
  const unit = (result.rows as unknown as UnitContext[])[0];
  if (!unit) throw new Error("Unit not found");
  return { ...unit, status: unitStatusSchema.parse(unit.status) };
}

async function lockLead(tx: Tx, orgId: string, leadId: string): Promise<LeadContext> {
  const result = await tx.execute(sql`
    SELECT l.id, l.person_id AS "personId", l.project_id AS "projectId",
           l.owner_user_id AS "ownerUserId", l.stage::text AS stage,
           l.is_test AS "isTest", l.created_at AS "createdAt", l.updated_at AS "updatedAt",
           l.first_touchpoint_id AS "firstTouchpointId",
           t.attribution_expires_at AS "attributionExpiresAt"
    FROM leads l
    JOIN persons pe ON pe.id = l.person_id AND pe.org_id = l.org_id
    JOIN projects pr ON pr.id = l.project_id AND pr.org_id = l.org_id
    LEFT JOIN lead_touchpoints t
      ON t.id = l.first_touchpoint_id AND t.org_id = l.org_id
    WHERE l.org_id = ${orgId} AND l.id = ${leadId}
    FOR UPDATE OF l
  `);
  const lead = (result.rows as unknown as LeadContext[])[0];
  if (!lead) throw new Error("Lead not found or it is not assigned to a project");
  if (lead.isTest) throw new Error("Test leads cannot be converted into commercial bookings");
  return lead;
}

async function lockBooking(tx: Tx, orgId: string, bookingId: string): Promise<BookingContext> {
  const linkResult = await tx.execute(sql`
    SELECT b.lead_id AS "leadId", b.person_id AS "personId",
           b.unit_id AS "unitId", b.project_id AS "projectId"
    FROM bookings b
    JOIN leads l ON l.id = b.lead_id AND l.org_id = b.org_id
    JOIN persons pe ON pe.id = b.person_id AND pe.id = l.person_id AND pe.org_id = b.org_id
    JOIN projects pr
      ON pr.id = b.project_id AND pr.id = l.project_id AND pr.org_id = b.org_id
    JOIN units u
      ON u.id = b.unit_id AND u.project_id = b.project_id AND u.org_id = b.org_id
    WHERE b.org_id = ${orgId} AND b.id = ${bookingId}
  `);
  const link = (linkResult.rows as unknown as {
    leadId: string;
    personId: string;
    unitId: string;
    projectId: string;
  }[])[0];
  if (!link) throw new Error("Booking not found or its ownership links are invalid");

  // Every commercial workflow takes locks in lead -> unit -> booking order.
  // That keeps create, payment, milestone, and cancellation transactions from
  // deadlocking while they protect the same buyer and inventory row.
  const lead = await lockLead(tx, orgId, link.leadId);
  const unit = await lockUnit(tx, orgId, link.unitId);
  if (
    lead.personId !== link.personId ||
    lead.projectId !== link.projectId ||
    unit.projectId !== link.projectId
  ) {
    throw new Error("Booking ownership links are invalid");
  }

  const result = await tx.execute(sql`
    SELECT id AS "bookingId", reference AS "bookingReference", status AS "bookingStatus",
           unit_id AS "unitId", agreement_value AS "agreementValue",
           token_amount AS "tokenAmount", token_paid_at AS "tokenPaidAt", booked_at AS "bookedAt"
    FROM bookings
    WHERE org_id = ${orgId} AND id = ${bookingId}
      AND lead_id = ${lead.id} AND person_id = ${lead.personId}
      AND unit_id = ${unit.id} AND project_id = ${lead.projectId}
    FOR UPDATE
  `);
  const commercial = (result.rows as unknown as {
    bookingId: string;
    bookingReference: string;
    bookingStatus: string;
    unitId: string;
    agreementValue: string | null;
    tokenAmount: string | null;
    tokenPaidAt: Date | null;
    bookedAt: Date | null;
  }[])[0];
  if (!commercial) throw new Error("Booking changed while it was being locked");
  return {
    ...lead,
    ...commercial,
    bookingStatus: bookingStatusSchema.parse(commercial.bookingStatus),
  };
}

async function currentActiveHolds(tx: Tx, orgId: string, unitId: string) {
  await tx.execute(sql`
    UPDATE unit_holds
    SET released_at = now(), release_reason = 'Expired automatically'
    WHERE org_id = ${orgId} AND unit_id = ${unitId}
      AND released_at IS NULL AND expires_at <= now()
  `);
  const result = await tx.execute(sql`
    SELECT id, lead_id AS "leadId", expires_at AS "expiresAt"
    FROM unit_holds
    WHERE org_id = ${orgId} AND unit_id = ${unitId}
      AND released_at IS NULL AND expires_at > now()
    ORDER BY created_at DESC
    FOR UPDATE
  `);
  return result.rows as unknown as { id: string; leadId: string; expiresAt: Date }[];
}

async function activeBookingFor(
  tx: Tx,
  orgId: string,
  leadId: string,
  unitId: string,
  excludedBookingId?: string,
) {
  const result = await tx.execute(sql`
    SELECT id, lead_id AS "leadId", unit_id AS "unitId", status
    FROM bookings
    WHERE org_id = ${orgId} AND status <> 'cancelled'
      AND (lead_id = ${leadId} OR unit_id = ${unitId})
      AND (${excludedBookingId ?? null}::uuid IS NULL OR id <> ${excludedBookingId ?? null}::uuid)
    LIMIT 1
    FOR UPDATE
  `);
  return result.rows[0] ?? null;
}

async function writeAudit(
  tx: Tx,
  input: {
    orgId: string;
    actorUserId: string;
    action: string;
    entityType: string;
    entityId: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  },
) {
  await tx.insert(auditLogs).values({
    id: randomUUID(),
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    actorType: "user",
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: input.before ?? null,
    after: input.after ?? null,
  });
}

async function modelledValue(
  tx: Tx,
  projectId: string,
  stage: ForwardStage,
): Promise<number | null> {
  const result = await tx.execute(sql`
    SELECT avg_sale_value
    FROM projects
    WHERE id = ${projectId}
    LIMIT 1
  `);
  const raw = (result.rows as unknown as { avg_sale_value: string | null }[])[0]?.avg_sale_value;
  const expected = Number(raw);
  if (!raw || !Number.isFinite(expected)) return null;
  return Math.round(expected * DEFAULT_STAGE_PRIORS[stage] * 100) / 100;
}

async function advanceLead(
  tx: Tx,
  context: LeadContext,
  orgId: string,
  actorUserId: string,
  target: ForwardStage,
  reason: string,
  now: Date,
): Promise<void> {
  if (context.stage === "lost" || context.stage === "disqualified") {
    throw new Error("A lost or disqualified lead must be reopened before booking");
  }
  if (STAGE_ORDER[context.stage as ForwardStage] >= STAGE_ORDER[target]) return;

  const previousAt = new Date(context.updatedAt ?? context.createdAt);
  await tx.insert(leadStageHistory).values({
    id: randomUUID(),
    orgId,
    leadId: context.id,
    fromStage: context.stage as never,
    toStage: target as never,
    durationInPreviousSeconds: Math.max(
      0,
      Math.floor((now.getTime() - previousAt.getTime()) / 1000),
    ),
    changedByUserId: actorUserId,
    changedBy: "user",
    reason,
    createdAt: now,
  });
  await tx
    .update(leads)
    .set({
      stage: target as never,
      lastActivityAt: now,
      updatedAt: now,
      ...(target === "booked" ? { closedAt: now } : {}),
    })
    .where(and(eq(leads.orgId, orgId), eq(leads.id, context.id)));
  context.stage = target;
  context.updatedAt = now;
}

async function emitBookingEvent(
  tx: Tx,
  context: LeadContext,
  input: {
    orgId: string;
    bookingId: string;
    eventType: "token_paid" | "booking_confirmed" | "sale_completed" | "booking_cancelled";
    occurredAt: Date;
    value: number | null;
    stage: "token_paid" | "booked";
    metadata?: Record<string, unknown>;
  },
) {
  const eventKey = {
    token_paid: eventKeyFor.tokenPaid,
    booking_confirmed: eventKeyFor.bookingConfirmed,
    sale_completed: eventKeyFor.saleCompleted,
    booking_cancelled: eventKeyFor.bookingCancelled,
  }[input.eventType](input.bookingId);

  await emitConversionEvent(tx, {
    orgId: input.orgId,
    eventType: input.eventType,
    personId: context.personId,
    leadId: context.id,
    projectId: context.projectId,
    touchpointId: context.firstTouchpointId,
    occurredAt: input.occurredAt,
    eventKey,
    value: input.value,
    stageAtEvent: input.stage,
    sourceEntityType: "booking",
    sourceEntityId: input.bookingId,
    metadata: input.metadata,
    attributionExpiresAt: context.attributionExpiresAt,
  });
}

export async function createUnitAction(formData: FormData) {
  const user = await requirePermission("inventory:write");
  const input = createUnitSchema.parse(Object.fromEntries(formData));
  const unitId = randomUUID();

  await getDb().transaction(async (tx) => {
    await assertProject(tx, user.orgId, input.projectId);
    await tx.execute(sql`
      INSERT INTO units (
        id, org_id, project_id, tower, unit_number, floor, configuration,
        carpet_area_sqft, saleable_area_sqft, facing, base_price, all_in_price, status
      ) VALUES (
        ${unitId}, ${user.orgId}, ${input.projectId}, ${input.tower ?? ""}, ${input.unitNumber},
        ${input.floor}, ${input.configuration}, ${decimal(input.carpetAreaSqft)},
        ${decimal(input.saleableAreaSqft)}, ${input.facing}, ${decimal(input.basePrice)},
        ${decimal(input.allInPrice)}, 'available'
      )
    `);
    await writeAudit(tx, {
      orgId: user.orgId,
      actorUserId: user.id,
      action: "unit.created",
      entityType: "unit",
      entityId: unitId,
      after: { ...input, status: "available" },
    });
  });

  revalidateCommercial();
}

export async function updateUnitAction(formData: FormData) {
  const user = await requirePermission("inventory:write");
  const input = updateUnitSchema.parse(Object.fromEntries(formData));

  await getDb().transaction(async (tx) => {
    const unit = await lockUnit(tx, user.orgId, input.unitId);
    await tx.execute(sql`
      UPDATE units
      SET tower = ${input.tower ?? ""}, unit_number = ${input.unitNumber}, floor = ${input.floor},
          configuration = ${input.configuration}, carpet_area_sqft = ${decimal(input.carpetAreaSqft)},
          saleable_area_sqft = ${decimal(input.saleableAreaSqft)}, facing = ${input.facing},
          base_price = ${decimal(input.basePrice)}, all_in_price = ${decimal(input.allInPrice)},
          updated_at = now()
      WHERE org_id = ${user.orgId} AND id = ${input.unitId}
    `);
    await writeAudit(tx, {
      orgId: user.orgId,
      actorUserId: user.id,
      action: "unit.updated",
      entityType: "unit",
      entityId: input.unitId,
      before: { unitNumber: unit.unitNumber, status: unit.status },
      after: input,
    });
  });

  revalidateCommercial();
}

export async function setUnitStatusAction(formData: FormData) {
  const user = await requirePermission("inventory:write");
  const input = z
    .object({ unitId: z.string().uuid(), status: unitStatusSchema })
    .parse(Object.fromEntries(formData));

  await getDb().transaction(async (tx) => {
    const unit = await lockUnit(tx, user.orgId, input.unitId);
    const holds = await currentActiveHolds(tx, user.orgId, input.unitId);
    const bookingResult = await tx.execute(sql`
      SELECT id, status
      FROM bookings
      WHERE org_id = ${user.orgId} AND unit_id = ${input.unitId} AND status <> 'cancelled'
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
    `);
    const booking = bookingResult.rows[0] as { id: string; status: string } | undefined;

    if ((input.status === "available" || input.status === "blocked") && (holds.length || booking)) {
      throw new Error("Release the hold or cancel the booking before changing availability");
    }
    if (input.status === "held" && holds.length === 0) {
      throw new Error("Held status requires an active hold record");
    }
    if (input.status === "held" && booking) {
      throw new Error("A booked unit cannot be moved back to a hold");
    }
    if (["token_paid", "booked", "registered"].includes(input.status)) {
      if (holds.length) throw new Error("Release the hold before applying a financial state");
      const expected =
        booking?.status === "token"
          ? "token_paid"
          : booking?.status === "registered"
            ? "registered"
            : booking && ["booked", "agreement_signed"].includes(booking.status)
              ? "booked"
              : null;
      if (expected !== input.status) {
        throw new Error("Financial unit states must be backed by a matching booking record");
      }
    }

    await tx.execute(sql`
      UPDATE units
      SET status = ${input.status}::unit_status, updated_at = now()
      WHERE org_id = ${user.orgId} AND id = ${input.unitId}
    `);
    await writeAudit(tx, {
      orgId: user.orgId,
      actorUserId: user.id,
      action: "unit.status_changed",
      entityType: "unit",
      entityId: input.unitId,
      before: { status: unit.status },
      after: { status: input.status },
    });
  });

  revalidateCommercial();
}

export async function holdUnitAction(formData: FormData) {
  const user = await requirePermission("inventory:write");
  const input = holdUnitSchema.parse(Object.fromEntries(formData));

  await getDb().transaction(async (tx) => {
    const lead = await lockLead(tx, user.orgId, input.leadId);
    const unit = await lockUnit(tx, user.orgId, input.unitId);
    if (lead.projectId !== unit.projectId) throw new Error("Lead and unit belong to different projects");
    if (lead.stage === "booked" || lead.stage === "lost" || lead.stage === "disqualified") {
      throw new Error("This lead cannot hold another unit in its current stage");
    }
    if (!["available", "held"].includes(unit.status)) {
      throw new Error("Only available inventory can be held");
    }
    if (await activeBookingFor(tx, user.orgId, lead.id, unit.id)) {
      throw new Error("The lead or unit already has an active booking");
    }

    const activeHolds = await currentActiveHolds(tx, user.orgId, unit.id);
    if (activeHolds.some((hold) => hold.leadId !== lead.id)) {
      throw new Error("Unit is held for another lead");
    }
    const current = activeHolds[0] ?? null;

    const expiresAt = new Date(Date.now() + input.hours * 60 * 60 * 1000);
    const holdId = current?.id ?? randomUUID();
    if (current) {
      await tx.execute(sql`
        UPDATE unit_holds
        SET released_at = now(), release_reason = 'Duplicate hold consolidated'
        WHERE org_id = ${user.orgId} AND unit_id = ${unit.id} AND lead_id = ${lead.id}
          AND released_at IS NULL AND id <> ${current.id}
      `);
      await tx.execute(sql`
        UPDATE unit_holds
        SET expires_at = ${expiresAt}, held_by_user_id = ${user.id}
        WHERE org_id = ${user.orgId} AND id = ${current.id}
      `);
    } else {
      await tx.execute(sql`
        INSERT INTO unit_holds (id, org_id, unit_id, lead_id, held_by_user_id, expires_at)
        VALUES (${holdId}, ${user.orgId}, ${unit.id}, ${lead.id}, ${user.id}, ${expiresAt})
      `);
    }
    await tx.execute(sql`
      UPDATE units SET status = 'held', updated_at = now()
      WHERE org_id = ${user.orgId} AND id = ${unit.id}
    `);
    await writeAudit(tx, {
      orgId: user.orgId,
      actorUserId: user.id,
      action: current ? "unit.hold_extended" : "unit.held",
      entityType: "unit_hold",
      entityId: holdId,
      after: { unitId: unit.id, leadId: lead.id, expiresAt: expiresAt.toISOString(), reason: input.reason },
    });
  });

  revalidateCommercial(input.leadId);
}

export async function releaseUnitHoldAction(formData: FormData) {
  const user = await requirePermission("inventory:write");
  const input = z
    .object({
      holdId: z.string().uuid(),
      releaseReason: z.string().trim().min(1).max(500).default("Released manually"),
    })
    .parse(Object.fromEntries(formData));

  let leadId: string | undefined;
  await getDb().transaction(async (tx) => {
    const result = await tx.execute(sql`
      SELECT uh.id, uh.unit_id AS "unitId", uh.lead_id AS "leadId", uh.released_at AS "releasedAt"
      FROM unit_holds uh
      JOIN units u ON u.id = uh.unit_id AND u.org_id = uh.org_id
      JOIN leads l ON l.id = uh.lead_id AND l.org_id = uh.org_id
      WHERE uh.org_id = ${user.orgId} AND uh.id = ${input.holdId}
      FOR UPDATE OF uh, u, l
    `);
    const hold = (result.rows as unknown as {
      id: string;
      unitId: string;
      leadId: string;
      releasedAt: Date | null;
    }[])[0];
    if (!hold) throw new Error("Hold not found");
    leadId = hold.leadId;
    if (hold.releasedAt) return;

    await tx.execute(sql`
      UPDATE unit_holds
      SET released_at = now(), release_reason = ${input.releaseReason}
      WHERE org_id = ${user.orgId} AND id = ${hold.id}
    `);
    const bookingResult = await tx.execute(sql`
      SELECT status FROM bookings
      WHERE org_id = ${user.orgId} AND unit_id = ${hold.unitId} AND status <> 'cancelled'
      ORDER BY created_at DESC LIMIT 1
    `);
    const status = String(bookingResult.rows[0]?.status ?? "");
    const unitStatus =
      status === "token"
        ? "token_paid"
        : status === "registered"
          ? "registered"
          : status === "booked" || status === "agreement_signed"
            ? "booked"
            : "available";
    await tx.execute(sql`
      UPDATE units SET status = ${unitStatus}::unit_status, updated_at = now()
      WHERE org_id = ${user.orgId} AND id = ${hold.unitId}
    `);
    await writeAudit(tx, {
      orgId: user.orgId,
      actorUserId: user.id,
      action: "unit.hold_released",
      entityType: "unit_hold",
      entityId: hold.id,
      before: { releasedAt: null },
      after: { releaseReason: input.releaseReason },
    });
  });

  revalidateCommercial(leadId);
}

export async function createBookingAction(formData: FormData) {
  const user = await requirePermission("bookings:write");
  const input = createBookingSchema.parse(Object.fromEntries(formData));
  const receivedAt = input.receivedAt
    ? parseLocalDateTime(input.receivedAt, user.timezone)
    : new Date();
  if (!receivedAt) throw new Error("Choose a valid payment time");
  const bookingId = randomUUID();

  await getDb().transaction(async (tx) => {
    const lead = await lockLead(tx, user.orgId, input.leadId);
    const unit = await lockUnit(tx, user.orgId, input.unitId);
    if (lead.projectId !== unit.projectId) throw new Error("Lead and unit belong to different projects");
    if (lead.stage === "booked" || lead.stage === "lost" || lead.stage === "disqualified") {
      throw new Error("This lead cannot be booked in its current stage");
    }
    if (!["available", "held"].includes(unit.status)) throw new Error("Unit is not bookable");
    if (await activeBookingFor(tx, user.orgId, lead.id, unit.id)) {
      throw new Error("The lead or unit already has an active booking");
    }
    const holds = await currentActiveHolds(tx, user.orgId, unit.id);
    if (holds.some((hold) => hold.leadId !== lead.id)) {
      throw new Error("Unit is held for another lead");
    }

    const sequenceResult = await tx.execute(sql`
      SELECT nextval('booking_reference_seq')::bigint::text AS sequence
    `);
    const sequence = String(sequenceResult.rows[0]?.sequence ?? "0").padStart(6, "0");
    const reference = `BK-${new Date().getFullYear()}-${sequence}`;
    const now = new Date();
    const agreementValue = decimal(input.agreementValue);
    const tokenAmount = decimal(input.tokenAmount);

    await tx.execute(sql`
      INSERT INTO bookings (
        id, org_id, reference, lead_id, person_id, unit_id, project_id, status,
        agreement_value, token_amount, token_paid_at, booked_at, closed_by_user_id
      ) VALUES (
        ${bookingId}, ${user.orgId}, ${reference}, ${lead.id}, ${lead.personId}, ${unit.id},
        ${lead.projectId}, ${input.initialStatus}, ${agreementValue}, ${tokenAmount},
        ${receivedAt}, ${input.initialStatus === "booked" ? now : null},
        ${lead.ownerUserId ?? user.id}
      )
    `);
    const paymentId = randomUUID();
    await tx.execute(sql`
      INSERT INTO payments (
        id, org_id, booking_id, amount, kind, mode, reference, received_at, recorded_by_user_id
      ) VALUES (
        ${paymentId}, ${user.orgId}, ${bookingId}, ${tokenAmount}, 'token',
        ${input.paymentMode}, ${input.paymentReference}, ${receivedAt}, ${user.id}
      )
    `);
    await tx.execute(sql`
      UPDATE unit_holds
      SET released_at = ${now}, release_reason = 'Converted to booking'
      WHERE org_id = ${user.orgId} AND unit_id = ${unit.id} AND released_at IS NULL
    `);
    await tx.execute(sql`
      UPDATE units
      SET status = ${input.initialStatus === "booked" ? "booked" : "token_paid"}::unit_status,
          updated_at = ${now}
      WHERE org_id = ${user.orgId} AND id = ${unit.id}
    `);

    await advanceLead(tx, lead, user.orgId, user.id, "token_paid", `Token recorded for ${reference}`, now);
    await emitBookingEvent(tx, lead, {
      orgId: user.orgId,
      bookingId,
      eventType: "token_paid",
      occurredAt: receivedAt,
      value: await modelledValue(tx, lead.projectId, "token_paid"),
      stage: "token_paid",
      metadata: { paymentId, amount: input.tokenAmount },
    });

    if (input.initialStatus === "booked") {
      await advanceLead(tx, lead, user.orgId, user.id, "booked", `Booking confirmed as ${reference}`, now);
      await emitBookingEvent(tx, lead, {
        orgId: user.orgId,
        bookingId,
        eventType: "booking_confirmed",
        occurredAt: now,
        value: input.agreementValue ?? (await modelledValue(tx, lead.projectId, "booked")),
        stage: "booked",
      });
    }

    await writeAudit(tx, {
      orgId: user.orgId,
      actorUserId: user.id,
      action: "booking.created",
      entityType: "booking",
      entityId: bookingId,
      after: {
        reference,
        leadId: lead.id,
        unitId: unit.id,
        status: input.initialStatus,
        agreementValue,
        tokenAmount,
        paymentId,
      },
    });
  });

  revalidateCommercial(input.leadId, bookingId);
  redirect(`/bookings/${bookingId}`);
}

export async function recordPaymentAction(formData: FormData) {
  const user = await requirePermission("bookings:write");
  const input = paymentSchema.parse(Object.fromEntries(formData));
  const receivedAt = input.receivedAt
    ? parseLocalDateTime(input.receivedAt, user.timezone)
    : new Date();
  if (!receivedAt) throw new Error("Choose a valid payment time");
  const paymentId = input.paymentId;
  let leadId: string | undefined;

  await getDb().transaction(async (tx) => {
    const booking = await lockBooking(tx, user.orgId, input.bookingId);
    leadId = booking.id;
    const existingResult = await tx.execute(sql`
      SELECT booking_id AS "bookingId", amount, kind, mode, reference,
             received_at AS "receivedAt"
      FROM payments
      WHERE org_id = ${user.orgId} AND id = ${paymentId}
      LIMIT 1
    `);
    const existing = existingResult.rows[0] as
      | {
          bookingId: string;
          amount: string;
          kind: string;
          mode: string | null;
          reference: string | null;
          receivedAt: Date | string;
        }
      | undefined;
    if (existing) {
      if (
        existing.bookingId !== booking.bookingId ||
        Number(existing.amount) !== input.amount ||
        existing.kind !== input.kind ||
        existing.mode !== input.mode ||
        existing.reference !== input.reference ||
        // A blank value means "recorded now" and is resolved by the first
        // successful attempt. Explicit financial timestamps must match on a
        // replay just like amount, kind, mode, and reference do.
        (Boolean(input.receivedAt) &&
          new Date(existing.receivedAt).getTime() !== receivedAt.getTime())
      ) {
        throw new Error("Payment operation id was already used with different details");
      }
      return;
    }
    if (booking.bookingStatus === "cancelled" && input.kind !== "refund") {
      throw new Error("Only refunds may be recorded against a cancelled booking");
    }
    if (input.kind === "token" && booking.bookingStatus !== "token") {
      throw new Error("Additional token payments are only valid before booking confirmation");
    }
    if (input.kind === "refund") {
      const collectionResult = await tx.execute(sql`
        SELECT COALESCE(SUM(CASE
          WHEN is_reversed THEN 0
          WHEN kind = 'refund' THEN -amount
          ELSE amount
        END), 0) AS collected
        FROM payments
        WHERE org_id = ${user.orgId} AND booking_id = ${booking.bookingId}
      `);
      const collected = Number(collectionResult.rows[0]?.collected ?? 0);
      if (!Number.isFinite(collected) || input.amount > collected) {
        throw new Error("Refund cannot exceed the booking's net collected amount");
      }
    }

    await tx.execute(sql`
      INSERT INTO payments (
        id, org_id, booking_id, amount, kind, mode, reference, received_at, recorded_by_user_id
      ) VALUES (
        ${paymentId}, ${user.orgId}, ${booking.bookingId}, ${decimal(input.amount)}, ${input.kind},
        ${input.mode}, ${input.reference}, ${receivedAt}, ${user.id}
      )
    `);

    if (input.kind === "token") {
      const now = new Date();
      await tx.execute(sql`
        UPDATE bookings
        SET token_amount = COALESCE(token_amount, 0) + ${decimal(input.amount)},
            token_paid_at = COALESCE(token_paid_at, ${receivedAt}),
            updated_at = ${now}
        WHERE org_id = ${user.orgId} AND id = ${booking.bookingId}
      `);
      if (booking.bookingStatus === "token") {
        await tx.execute(sql`
          UPDATE units SET status = 'token_paid', updated_at = ${now}
          WHERE org_id = ${user.orgId} AND id = ${booking.unitId}
        `);
      }
      await advanceLead(
        tx,
        booking,
        user.orgId,
        user.id,
        "token_paid",
        `Token payment recorded for ${booking.bookingReference}`,
        now,
      );
      await emitBookingEvent(tx, booking, {
        orgId: user.orgId,
        bookingId: booking.bookingId,
        eventType: "token_paid",
        occurredAt: booking.tokenPaidAt ?? receivedAt,
        value: await modelledValue(tx, booking.projectId, "token_paid"),
        stage: "token_paid",
        metadata: { paymentId, amount: input.amount },
      });
    }

    await writeAudit(tx, {
      orgId: user.orgId,
      actorUserId: user.id,
      action: input.kind === "refund" ? "payment.refund_recorded" : "payment.recorded",
      entityType: "payment",
      entityId: paymentId,
      after: {
        bookingId: booking.bookingId,
        amount: input.amount,
        kind: input.kind,
        mode: input.mode,
        reference: input.reference,
        receivedAt: receivedAt.toISOString(),
      },
    });
  });

  revalidateCommercial(leadId, input.bookingId);
}

export async function advanceBookingAction(formData: FormData) {
  const user = await requirePermission("bookings:write");
  const input = advanceBookingSchema.parse(Object.fromEntries(formData));
  let leadId: string | undefined;

  await getDb().transaction(async (tx) => {
    const booking = await lockBooking(tx, user.orgId, input.bookingId);
    leadId = booking.id;
    const expectedNext: Partial<Record<z.infer<typeof bookingStatusSchema>, string>> = {
      token: "booked",
      booked: "agreement_signed",
      agreement_signed: "registered",
    };
    if (expectedNext[booking.bookingStatus] !== input.targetStatus) {
      throw new Error(`Booking must advance from ${booking.bookingStatus} to its next state`);
    }

    const agreementValue = input.agreementValue ?? Number(booking.agreementValue);
    if (input.targetStatus === "booked" && (!agreementValue || !Number.isFinite(agreementValue))) {
      throw new Error("Agreement value is required before confirming a booking");
    }
    const now = new Date();
    await tx.execute(sql`
      UPDATE bookings
      SET status = ${input.targetStatus},
          agreement_value = COALESCE(${decimal(input.agreementValue)}, agreement_value),
          booked_at = CASE WHEN ${input.targetStatus} = 'booked' THEN ${now} ELSE booked_at END,
          agreement_signed_at = CASE WHEN ${input.targetStatus} = 'agreement_signed' THEN ${now} ELSE agreement_signed_at END,
          registered_at = CASE WHEN ${input.targetStatus} = 'registered' THEN ${now} ELSE registered_at END,
          updated_at = ${now}
      WHERE org_id = ${user.orgId} AND id = ${booking.bookingId}
    `);
    const unitStatus = input.targetStatus === "registered" ? "registered" : "booked";
    await tx.execute(sql`
      UPDATE units SET status = ${unitStatus}::unit_status, updated_at = ${now}
      WHERE org_id = ${user.orgId} AND id = ${booking.unitId}
    `);

    if (input.targetStatus === "booked") {
      await advanceLead(
        tx,
        booking,
        user.orgId,
        user.id,
        "booked",
        `Booking confirmed as ${booking.bookingReference}`,
        now,
      );
      await emitBookingEvent(tx, booking, {
        orgId: user.orgId,
        bookingId: booking.bookingId,
        eventType: "booking_confirmed",
        occurredAt: now,
        value: agreementValue,
        stage: "booked",
      });
    }
    // Agreement signing is an important CRM milestone, but registration is the
    // ground-truth sale. Emitting `sale_completed` at both steps would mark the
    // conversion too early and the deterministic event key would then suppress
    // the real registration event.
    if (input.targetStatus === "registered") {
      await emitBookingEvent(tx, booking, {
        orgId: user.orgId,
        bookingId: booking.bookingId,
        eventType: "sale_completed",
        occurredAt: now,
        value: agreementValue || null,
        stage: "booked",
        metadata: { milestone: input.targetStatus },
      });
    }

    await writeAudit(tx, {
      orgId: user.orgId,
      actorUserId: user.id,
      action: `booking.${input.targetStatus}`,
      entityType: "booking",
      entityId: booking.bookingId,
      before: { status: booking.bookingStatus, agreementValue: booking.agreementValue },
      after: { status: input.targetStatus, agreementValue },
    });
  });

  revalidateCommercial(leadId, input.bookingId);
}

export async function cancelBookingAction(formData: FormData) {
  const user = await requirePermission("bookings:write");
  const input = z
    .object({
      bookingId: z.string().uuid(),
      reason: z.string().trim().min(3).max(1000),
    })
    .parse(Object.fromEntries(formData));
  let leadId: string | undefined;

  await getDb().transaction(async (tx) => {
    const booking = await lockBooking(tx, user.orgId, input.bookingId);
    leadId = booking.id;
    if (booking.bookingStatus === "cancelled") return;
    if (booking.bookingStatus === "registered") {
      throw new Error("A registered sale cannot be cancelled from the booking workflow");
    }

    const now = new Date();
    await tx.execute(sql`
      UPDATE bookings
      SET status = 'cancelled', cancelled_at = ${now}, cancellation_reason = ${input.reason},
          updated_at = ${now}
      WHERE org_id = ${user.orgId} AND id = ${booking.bookingId}
    `);
    await tx.execute(sql`
      UPDATE units SET status = 'available', updated_at = ${now}
      WHERE org_id = ${user.orgId} AND id = ${booking.unitId}
    `);

    if (booking.stage !== "negotiating") {
      await tx.insert(leadStageHistory).values({
        id: randomUUID(),
        orgId: user.orgId,
        leadId: booking.id,
        fromStage: booking.stage as never,
        toStage: "negotiating",
        durationInPreviousSeconds: Math.max(
          0,
          Math.floor((now.getTime() - new Date(booking.updatedAt).getTime()) / 1000),
        ),
        changedByUserId: user.id,
        changedBy: "user",
        reason: `Booking ${booking.bookingReference} cancelled: ${input.reason}`,
        createdAt: now,
      });
    }
    await tx
      .update(leads)
      .set({ stage: "negotiating", closedAt: null, lastActivityAt: now, updatedAt: now })
      .where(and(eq(leads.orgId, user.orgId), eq(leads.id, booking.id)));

    await emitBookingEvent(tx, booking, {
      orgId: user.orgId,
      bookingId: booking.bookingId,
      eventType: "booking_cancelled",
      occurredAt: now,
      value: null,
      stage: booking.stage === "booked" ? "booked" : "token_paid",
      metadata: { reason: input.reason, agreementValue: booking.agreementValue },
    });
    await writeAudit(tx, {
      orgId: user.orgId,
      actorUserId: user.id,
      action: "booking.cancelled",
      entityType: "booking",
      entityId: booking.bookingId,
      before: { status: booking.bookingStatus },
      after: { status: "cancelled", reason: input.reason },
    });
  });

  revalidateCommercial(leadId, input.bookingId);
}
