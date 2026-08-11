"use server";

import { randomUUID } from "node:crypto";
import {
  DEFAULT_STAGE_PRIORS,
  STAGE_EVENT_MAP,
  checkTransition,
  type ConversionEventType,
  type ForwardStage,
  type LeadStage,
} from "@monark/core";
import { activities, auditLogs, getDb, leadStageHistory, leads, leadTouchpoints, projects, users, visits } from "@monark/db";
import { emitConversionEvent, eventKeyFor } from "@monark/services";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission, type SessionUser } from "./auth";
import { publishChange } from "./realtime";
import { localDateTimeSchema, parseLocalDateTime } from "./datetime";
import { insertFollowUpTask, type FollowUpDraft } from "./follow-up-sync";
import { FOLLOW_UP_CHANNELS } from "./follow-ups";
import { lockLeadForUpdate } from "./lead-lock";
import {
  BOARD_MOVE_STAGES,
  EDITABLE_STAGES,
  LOST_REASONS,
  isEditableStage,
  isRegressableStage,
  type LostReason,
} from "./stage-edit";

const stageChangeSchema = z.object({
  leadId: z.string().uuid(),
  toStage: z.enum(EDITABLE_STAGES),
  reason: z.string().trim().max(500).optional(),
  reasonCode: z.preprocess((value) => String(value ?? "").trim() || undefined, z.enum(LOST_REASONS).optional()),
  doNotContact: z.boolean().optional(),
});

/** Board moves may also land on visit_scheduled / visited when correcting a regression. */
const boardMoveSchema = z.object({
  leadId: z.string().uuid(),
  toStage: z.enum(BOARD_MOVE_STAGES),
  reason: z.string().trim().max(500).optional(),
  reasonCode: z.preprocess((value) => String(value ?? "").trim() || undefined, z.enum(LOST_REASONS).optional()),
});

const leadProjectSchema = z.object({
  leadId: z.string().uuid(),
  projectId: z.preprocess(
    (value) => String(value ?? "").trim() || null,
    z.string().uuid().nullable(),
  ),
});

export async function updateLeadProject(formData: FormData) {
  const user = await requirePermission("leads:write");
  const parsed = leadProjectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Invalid project selection");

  await getDb().transaction(async (tx) => {
    if (!(await lockLeadForUpdate(tx, user.orgId, parsed.data.leadId, user))) {
      throw new Error("Lead not found");
    }
    const [lead] = await tx.select({ id: leads.id, projectId: leads.projectId }).from(leads)
      .where(and(eq(leads.id, parsed.data.leadId), eq(leads.orgId, user.orgId))).limit(1);
    if (!lead || lead.projectId === parsed.data.projectId) return;

    if (parsed.data.projectId) {
      const [project] = await tx.select({ id: projects.id }).from(projects).where(and(
        eq(projects.id, parsed.data.projectId), eq(projects.orgId, user.orgId), eq(projects.isActive, true),
      )).limit(1);
      if (!project) throw new Error("Project is not active in this organisation");
    }

    const isInitialAssignment = lead.projectId === null && parsed.data.projectId !== null;
    if (!isInitialAssignment) {
      const locked = await tx.execute(sql`
        SELECT (
          EXISTS (SELECT 1 FROM visits WHERE org_id = ${user.orgId} AND lead_id = ${lead.id}) OR
          EXISTS (SELECT 1 FROM unit_interests WHERE org_id = ${user.orgId} AND lead_id = ${lead.id}) OR
          EXISTS (SELECT 1 FROM bookings WHERE org_id = ${user.orgId} AND lead_id = ${lead.id}) OR
          EXISTS (SELECT 1 FROM activities WHERE org_id = ${user.orgId} AND lead_id = ${lead.id}
            AND metadata->>'kind' = 'negotiation_offer')
        ) AS locked
      `);
      if (Boolean(locked.rows[0]?.locked)) {
        throw new Error("Project cannot change after a visit or commercial activity is recorded");
      }
    }

    await tx.update(leads).set({ projectId: parsed.data.projectId, updatedAt: new Date() })
      .where(and(eq(leads.id, lead.id), eq(leads.orgId, user.orgId)));
    if (isInitialAssignment && parsed.data.projectId) {
      // Fresh walk-ins may be captured before the visitor chooses a project.
      // Once staff resolves it, attach only still-unclassified facts; never
      // rewrite a project already recorded on a visit or touchpoint.
      await tx.update(visits).set({ projectId: parsed.data.projectId, updatedAt: new Date() })
        .where(and(
          eq(visits.orgId, user.orgId),
          eq(visits.leadId, lead.id),
          isNull(visits.projectId),
        ));
      await tx.update(leadTouchpoints).set({ projectId: parsed.data.projectId })
        .where(and(
          eq(leadTouchpoints.orgId, user.orgId),
          eq(leadTouchpoints.leadId, lead.id),
          isNull(leadTouchpoints.projectId),
        ));
    }
    await tx.insert(auditLogs).values({
      id: randomUUID(), orgId: user.orgId, actorUserId: user.id,
      action: "lead.project_changed", entityType: "lead", entityId: lead.id,
      before: { projectId: lead.projectId }, after: { projectId: parsed.data.projectId },
    });
  });

  revalidatePath(`/leads/${parsed.data.leadId}`);
  revalidatePath("/leads");
  revalidatePath("/pipeline");
}

/**
 * Expected value for a conversion event.
 *
 * Uses P(booking | stage) × the project's average sale value, so every event we
 * report to Meta and Google is denominated in expected rupees of revenue rather
 * than an invented ladder. Priors are used until the nightly value-model job has
 * enough of Monark's own history to replace them — see
 * packages/core/src/conversions/value-model.ts.
 */
async function modelledValue(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  projectId: string | null,
  stage: ForwardStage,
): Promise<number | null> {
  if (!projectId) return null;
  const res = await tx.execute(
    sql`SELECT avg_sale_value FROM projects WHERE id = ${projectId} LIMIT 1`,
  );
  const raw = (res.rows as { avg_sale_value: string | null }[])[0]?.avg_sale_value;
  if (!raw) return null;
  const expected = Number(raw);
  if (!Number.isFinite(expected)) return null;
  return Math.round(expected * (DEFAULT_STAGE_PRIORS[stage] ?? 0) * 100) / 100;
}

/**
 * The one place a lead's stage moves.
 *
 * Shared by the lead page form and the pipeline board's drag-and-drop, because
 * a stage change is never only a column update: it appends history, may set
 * speed-to-lead, and emits the conversion event that reaches Meta and Google.
 * Two copies of that would drift, and the drift would be invisible until the
 * funnel numbers stopped adding up.
 */
interface SiteVisitInput {
  visitId: string;
  scheduledAt: Date;
  notes: string | null;
}

async function applyStageChange(
  user: SessionUser,
  input: {
    leadId: string;
    toStage: string;
    reason: string | null;
    reasonCode?: LostReason;
    followUp?: FollowUpDraft;
    siteVisit?: SiteVisitInput;
  },
) {
  const { leadId, toStage, reasonCode } = input;
  const reason = input.reason || null;
  const isTerminalChange = toStage === "lost" || toStage === "disqualified";
  if (isTerminalChange && !reasonCode) throw new Error("Choose a structured closing reason");

  // Workflow stages are evidence-backed going forward. The only hand edit we
  // allow is a regression with a reason — otherwise the visit/booking form
  // would be bypassed and Meta/Google would be fed a conversion that never
  // happened.
  if (!isEditableStage(toStage) && !isRegressableStage(toStage)) {
    throw new Error("That stage is set by its own workflow");
  }

  const db = getDb();

  await db.transaction(async (tx) => {
    if (!(await lockLeadForUpdate(tx, user.orgId, leadId, user))) {
      throw new Error("Lead not found");
    }
    const [lead] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.orgId, user.orgId)))
      .limit(1);
    if (!lead) throw new Error("Lead not found");

    const check = checkTransition(lead.stage as LeadStage, toStage as LeadStage);
    if (!check.allowed) throw new Error(check.reason ?? "Transition not allowed");
    if (check.requiresReason && !reason) throw new Error("A reason is required for this change");
    if (isRegressableStage(toStage) && !check.isRegression) {
      throw new Error("That stage is set by its own workflow");
    }

    const now = new Date();
    const previousAt = lead.updatedAt ?? lead.createdAt;
    const durationSeconds = Math.max(
      0,
      Math.floor((now.getTime() - new Date(previousAt).getTime()) / 1000),
    );

    // Append-only. Never overwrite the stage column alone — the history IS the
    // funnel, and every downstream conversion rate is derived from it.
    await tx.insert(leadStageHistory).values({
      id: randomUUID(),
      orgId: user.orgId,
      leadId,
      fromStage: lead.stage,
      toStage: toStage as never,
      durationInPreviousSeconds: durationSeconds,
      changedByUserId: user.id,
      changedBy: "user",
      reason,
    });

    // Speed-to-lead is captured the first time a lead is marked contacted, and
    // never revised — a later re-contact must not overwrite how long the buyer
    // originally waited.
    const isFirstContact = toStage === "contacted" && !lead.firstContactedAt;
    const firstResponseSeconds = isFirstContact
      ? Math.floor((now.getTime() - new Date(lead.createdAt).getTime()) / 1000)
      : lead.firstResponseSeconds;

    await tx
      .update(leads)
      .set({
        stage: toStage as never,
        lostReason: isTerminalChange ? (reasonCode as never) : null,
        lostNotes: isTerminalChange ? reason : null,
        lastActivityAt: now,
        updatedAt: now,
        ...(isFirstContact ? { firstContactedAt: now, firstResponseSeconds } : {}),
        ...(isTerminalChange ? { closedAt: now } : { closedAt: null }),
      })
      .where(eq(leads.id, leadId));

    // A regression is a correction of the funnel label, not a new conversion.
    // Emitting again would double-count visits and negotiations to the ad platforms.
    const eventType = STAGE_EVENT_MAP[toStage as ForwardStage] as ConversionEventType | undefined;
    if (eventType && !check.isRegression) {
      await emitConversionEvent(tx, {
        orgId: user.orgId,
        eventType,
        personId: lead.personId,
        leadId,
        projectId: lead.projectId,
        touchpointId: lead.firstTouchpointId,
        occurredAt: now,
        eventKey: eventKeyFor.stageEntered(leadId, toStage),
        value: await modelledValue(tx, lead.projectId, toStage as ForwardStage),
        stageAtEvent: toStage,
        sourceEntityType: "lead",
        sourceEntityId: leadId,
      });
    }

    // The follow-up is a task, not a column on the lead. Writing it any other
    // way would give the follow-up list and the task list two different
    // answers to "what happens next with this buyer".
    if (input.followUp) {
      await insertFollowUpTask(tx, {
        orgId: user.orgId,
        leadId,
        personId: lead.personId,
        // Whoever owns the lead does the work, falling back to the person who
        // moved the card when the lead is still unassigned.
        assigneeUserId: lead.ownerUserId ?? user.id,
        context: `moved to ${toStage.replace(/_/g, " ")}`,
        followUp: input.followUp,
      });
    }

    // An appointment, not an arrival. The move dialog books the next site
    // visit; the arrival is recorded separately when they actually turn up,
    // because "agreed to come" and "came" are different pieces of evidence and
    // only the second one earns a `site_visit_completed`.
    if (input.siteVisit) {
      if (!lead.projectId) {
        throw new Error("Assign a project before booking a site visit");
      }
      await tx.insert(visits).values({
        id: input.siteVisit.visitId,
        orgId: user.orgId,
        leadId,
        personId: lead.personId,
        projectId: lead.projectId,
        type: "project_site",
        status: "scheduled",
        scheduledAt: input.siteVisit.scheduledAt,
        hostUserId: lead.ownerUserId ?? user.id,
        notes: input.siteVisit.notes,
        createdByUserId: user.id,
      });
      await emitConversionEvent(tx, {
        orgId: user.orgId,
        eventType: "visit_scheduled",
        personId: lead.personId,
        leadId,
        projectId: lead.projectId,
        touchpointId: lead.firstTouchpointId,
        occurredAt: now,
        eventKey: eventKeyFor.visitScheduled(input.siteVisit.visitId),
        stageAtEvent: toStage,
        sourceEntityType: "visit",
        sourceEntityId: input.siteVisit.visitId,
      });
    }
  });

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/pipeline");
  revalidatePath("/leads");
  revalidatePath("/follow-ups");
  revalidatePath("/tasks");
  // Stage moves and the follow-ups booked with them are what the rest of the
  // team is watching; a board showing yesterday's column is worse than useless.
  await publishChange(user.orgId, "leads");
}

export async function changeStage(formData: FormData) {
  const user = await requirePermission("leads:write");
  const parsed = stageChangeSchema.safeParse({
    leadId: formData.get("leadId"),
    toStage: formData.get("toStage"),
    reason: formData.get("reason"),
    reasonCode: formData.get("reasonCode"),
    doNotContact: formData.get("doNotContact") === "on",
  });
  if (!parsed.success) throw new Error("Invalid stage change");

  await applyStageChange(user, {
    leadId: parsed.data.leadId,
    toStage: parsed.data.toStage,
    reason: parsed.data.reason ?? null,
    reasonCode: parsed.data.reasonCode,
  });

  // Same person-level suppression the Disqualify button uses — selecting
  // Disqualified from the stage dropdown must not skip the do-not-contact path.
  if (parsed.data.toStage === "disqualified" && parsed.data.doNotContact) {
    await getDb().execute(sql`
      UPDATE persons
      SET is_suppressed = true,
          suppression_reason = ${parsed.data.reason ?? "Disqualified"},
          updated_at = now()
      WHERE org_id = ${user.orgId}
        AND id = (
          SELECT person_id FROM leads
          WHERE id = ${parsed.data.leadId} AND org_id = ${user.orgId}
        )
    `);
    revalidatePath("/customers");
  }
}

export interface StageMoveResult {
  ok: boolean;
  message?: string;
}

export interface LeadRefundContext {
  bookingId: string;
  reference: string;
  status: string;
  agreementValue: string | null;
  /** Net of prior refunds, and what the refund tick would return. */
  netCollected: string;
}

/**
 * The money sitting against a lead, if any.
 *
 * Fetched when the disqualify dialog opens rather than shipped with every row:
 * the refund option only exists for the handful of leads that ever took a
 * payment, and asking about it up front would put a booking lookup behind
 * every Disqualify button on the customer table.
 */
export async function getLeadRefundContext(
  leadId: string,
): Promise<LeadRefundContext | null> {
  const user = await requirePermission("leads:write");
  if (!z.string().uuid().safeParse(leadId).success) return null;

  const result = await getDb().execute(sql`
    SELECT b.id AS "bookingId", b.reference, b.status::text AS status,
           b.agreement_value AS "agreementValue",
           COALESCE((
             SELECT SUM(CASE WHEN pm.kind = 'refund' THEN -pm.amount ELSE pm.amount END)
             FROM payments pm
             WHERE pm.booking_id = b.id AND pm.org_id = b.org_id AND pm.is_reversed = false
           ), 0)::text AS "netCollected"
    FROM bookings b
    WHERE b.org_id = ${user.orgId} AND b.lead_id = ${leadId} AND b.status <> 'cancelled'
    ORDER BY b.created_at DESC
    LIMIT 1
  `);
  const booking = result.rows[0] as unknown as LeadRefundContext | undefined;
  // Nothing to offer a refund on if no money ever arrived.
  if (!booking || Number(booking.netCollected) <= 0) return booking ?? null;
  return booking;
}

export interface LeadActionState {
  ok: boolean;
  message?: string;
}

/**
 * Disqualification, from wherever it is triggered.
 *
 * One action behind every surface — the lead page, the customer list, the stage
 * dropdown — because the three things it does have to happen together: the
 * structured reason (which feeds campaign quality reporting), the stage change
 * (which stops the lead appearing in work queues), and optionally the
 * do-not-contact flag.
 *
 * Do-not-contact is deliberately set on the PERSON, not the lead. Somebody who
 * asks not to be contacted means it for every enquiry they have ever made, and
 * a per-lead flag would let the next enquiry call them anyway.
 */
/**
 * Reverses the money on a lead being closed out.
 *
 * A refund is recorded as a payment of kind `refund` rather than by editing the
 * original figures: the collection actually happened, and erasing it would make
 * the ledger disagree with the bank. Every aggregate in the app already
 * subtracts refunds, so agreement value, net collected and outstanding all fall
 * out of this one row.
 *
 * Returns the formatted amount refunded, or null when there was nothing to
 * return.
 */
async function refundAndCancelBooking(
  user: SessionUser,
  leadId: string,
  reason: string,
): Promise<string | null> {
  const db = getDb();
  const found = await db.execute(sql`
    SELECT b.id, b.reference, b.status::text AS status, b.unit_id AS "unitId",
           COALESCE((
             SELECT SUM(CASE WHEN pm.kind = 'refund' THEN -pm.amount ELSE pm.amount END)
             FROM payments pm
             WHERE pm.booking_id = b.id AND pm.org_id = b.org_id AND pm.is_reversed = false
           ), 0)::text AS "netCollected"
    FROM bookings b
    WHERE b.org_id = ${user.orgId} AND b.lead_id = ${leadId} AND b.status <> 'cancelled'
    ORDER BY b.created_at DESC
    LIMIT 1
  `);
  const booking = found.rows[0] as
    | { id: string; reference: string; status: string; unitId: string | null; netCollected: string }
    | undefined;
  if (!booking) return null;
  if (booking.status === "registered") {
    throw new Error("A registered sale cannot be refunded from here — cancel it in the booking register");
  }

  const amount = Number(booking.netCollected);
  const now = new Date();

  await db.transaction(async (tx) => {
    if (amount > 0) {
      await tx.execute(sql`
        INSERT INTO payments (
          id, org_id, booking_id, amount, kind, mode, reference, received_at, recorded_by_user_id
        ) VALUES (
          ${randomUUID()}, ${user.orgId}, ${booking.id}, ${amount.toFixed(2)}, 'refund',
          null, ${`Refund on disqualification: ${reason}`}, ${now}, ${user.id}
        )
      `);
    }
    await tx.execute(sql`
      UPDATE bookings
      SET status = 'cancelled', cancelled_at = ${now},
          cancellation_reason = ${`Disqualified: ${reason}`}, updated_at = ${now}
      WHERE org_id = ${user.orgId} AND id = ${booking.id}
    `);
    // The flat goes back on the market the moment the sale is undone.
    if (booking.unitId) {
      await tx.execute(sql`
        UPDATE units SET status = 'available', updated_at = ${now}
        WHERE org_id = ${user.orgId} AND id = ${booking.unitId}
      `);
    }
    await tx.insert(auditLogs).values({
      id: randomUUID(),
      orgId: user.orgId,
      actorUserId: user.id,
      action: "booking.refunded",
      entityType: "booking",
      entityId: booking.id,
      before: { status: booking.status, netCollected: booking.netCollected },
      after: { status: "cancelled", refunded: amount },
    });
  });

  revalidatePath("/bookings");
  revalidatePath("/inventory");
  revalidatePath("/reports");
  return amount > 0 ? `₹${amount.toLocaleString("en-IN")}` : null;
}

export async function disqualifyLead(
  _previous: LeadActionState,
  formData: FormData,
): Promise<LeadActionState> {
  const user = await requirePermission("leads:write");
  const parsed = z
    .object({
      leadId: z.string().uuid(),
      reasonCode: z.enum(LOST_REASONS),
      reason: z.string().trim().min(3, "Add a short explanation").max(500),
      doNotContact: z.boolean(),
      refundBooking: z.boolean(),
    })
    .safeParse({
      leadId: formData.get("leadId"),
      reasonCode: formData.get("reasonCode"),
      reason: formData.get("reason"),
      doNotContact: formData.get("doNotContact") === "on",
      refundBooking: formData.get("refundBooking") === "on",
    });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Choose a reason" };
  }

  let refunded: string | null = null;
  try {
    // Money first. A lead cannot be closed out while a live booking still
    // holds a unit and counts toward agreement value — the board would show a
    // disqualified buyer owning an apartment.
    if (parsed.data.refundBooking) {
      refunded = await refundAndCancelBooking(user, parsed.data.leadId, parsed.data.reason);
    }
    await applyStageChange(user, {
      leadId: parsed.data.leadId,
      toStage: "disqualified",
      reason: parsed.data.reason,
      reasonCode: parsed.data.reasonCode,
    });
    if (parsed.data.doNotContact) {
      await getDb().execute(sql`
        UPDATE persons
        SET is_suppressed = true,
            suppression_reason = ${parsed.data.reason},
            updated_at = now()
        WHERE org_id = ${user.orgId}
          AND id = (
            SELECT person_id FROM leads
            WHERE id = ${parsed.data.leadId} AND org_id = ${user.orgId}
          )
      `);
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not disqualify this lead" };
  }

  revalidatePath("/customers");
  revalidatePath("/leads");
  revalidatePath("/pipeline");
  revalidatePath("/follow-ups");
  revalidatePath(`/leads/${parsed.data.leadId}`);
  const notes = [
    refunded ? `${refunded} refunded and the booking cancelled` : null,
    parsed.data.doNotContact ? "marked do not contact" : null,
  ].filter(Boolean);
  return {
    ok: true,
    message: notes.length ? `Disqualified · ${notes.join(" · ")}` : "Lead disqualified",
  };
}

/**
 * Advance one rung. Only the stages a person may set by hand — anything backed
 * by a visit or money still has to go through its own workflow, so this refuses
 * rather than faking the evidence.
 */
export async function promoteLead(
  _previous: LeadActionState,
  formData: FormData,
): Promise<LeadActionState> {
  const user = await requirePermission("leads:write");
  const parsed = z
    .object({ leadId: z.string().uuid(), toStage: z.enum(EDITABLE_STAGES) })
    .safeParse({ leadId: formData.get("leadId"), toStage: formData.get("toStage") });
  if (!parsed.success) {
    return { ok: false, message: "That stage is set by its own workflow — open the lead to record it" };
  }

  try {
    await applyStageChange(user, {
      leadId: parsed.data.leadId,
      toStage: parsed.data.toStage,
      reason: null,
    });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not move this lead" };
  }
  revalidatePath("/customers");
  revalidatePath("/leads");
  revalidatePath("/pipeline");
  return { ok: true, message: `Moved to ${parsed.data.toStage.replace(/_/g, " ")}` };
}

/**
 * Stage change from the pipeline board.
 *
 * Returns a result instead of throwing so the board can roll the card back to
 * the column it came from and say why, rather than replacing the whole screen
 * with an error boundary mid-drag.
 */
const boardFollowUpSchema = z.object({
  followUpAt: localDateTimeSchema,
  followUpChannel: z.enum(FOLLOW_UP_CHANNELS),
  followUpNote: z.preprocess(
    (value) => String(value ?? "").trim() || undefined,
    z.string().max(2000).optional(),
  ),
  followUpCommitment: z.preprocess(
    (value) => String(value ?? "").trim() || undefined,
    z.string().max(300).optional(),
  ),
});

export async function moveLeadStage(input: {
  leadId: string;
  toStage: string;
  reason?: string;
  reasonCode?: string;
  followUpAt?: string;
  followUpChannel?: string;
  followUpNote?: string;
  followUpCommitment?: string;
  siteVisitAt?: string;
  siteVisitNotes?: string;
}): Promise<StageMoveResult> {
  const user = await requirePermission("leads:write");
  const parsed = boardMoveSchema.safeParse({
    leadId: input.leadId,
    toStage: input.toStage,
    reason: input.reason,
    reasonCode: input.reasonCode,
  });
  if (!parsed.success) {
    return { ok: false, message: "That stage cannot be set from the board" };
  }

  let siteVisit: SiteVisitInput | undefined;
  if (input.siteVisitAt) {
    const parsedSiteVisit = z
      .object({
        siteVisitAt: localDateTimeSchema,
        siteVisitNotes: z.preprocess(
          (value) => String(value ?? "").trim() || undefined,
          z.string().max(2000).optional(),
        ),
      })
      .safeParse({
        siteVisitAt: input.siteVisitAt,
        siteVisitNotes: input.siteVisitNotes,
      });
    if (!parsedSiteVisit.success) {
      return { ok: false, message: parsedSiteVisit.error.issues[0]?.message ?? "Check the site visit details" };
    }
    const scheduledAt = parseLocalDateTime(parsedSiteVisit.data.siteVisitAt, user.timezone);
    if (!scheduledAt) return { ok: false, message: "Choose a valid site visit time" };
    // An appointment in the past is either a typo or an arrival that should be
    // checked in, and neither should be booked as an upcoming visit.
    if (scheduledAt.getTime() < Date.now() - 60_000) {
      return { ok: false, message: "Book the site visit for a future time — record a past one as a check-in" };
    }
    siteVisit = {
      visitId: randomUUID(),
      scheduledAt,
      notes: parsedSiteVisit.data.siteVisitNotes ?? null,
    };
  }

  let followUp: FollowUpDraft | undefined;
  if (input.followUpAt) {
    const parsedFollowUp = boardFollowUpSchema.safeParse({
      followUpAt: input.followUpAt,
      followUpChannel: input.followUpChannel,
      followUpNote: input.followUpNote,
      followUpCommitment: input.followUpCommitment,
    });
    if (!parsedFollowUp.success) {
      return { ok: false, message: parsedFollowUp.error.issues[0]?.message ?? "Check the follow-up details" };
    }
    const at = parseLocalDateTime(parsedFollowUp.data.followUpAt, user.timezone);
    if (!at) return { ok: false, message: "Choose a valid follow-up time" };
    // A follow-up already in the past is born overdue, which is almost always a
    // mis-typed date rather than an intention.
    if (at.getTime() < Date.now() - 60_000) {
      return { ok: false, message: "Choose a follow-up time in the future" };
    }
    followUp = {
      at,
      channel: parsedFollowUp.data.followUpChannel,
      note: parsedFollowUp.data.followUpNote ?? null,
      commitment: parsedFollowUp.data.followUpCommitment ?? null,
    };
  }

  try {
    await applyStageChange(user, {
      leadId: parsed.data.leadId,
      toStage: parsed.data.toStage,
      reason: parsed.data.reason ?? null,
      reasonCode: parsed.data.reasonCode,
      followUp,
      siteVisit,
    });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not move the lead" };
  }
  return { ok: true };
}

/**
 * Walk-in / site-visit check-in.
 *
 * `arrivedAt` is the whole point. Someone booking an appointment and someone
 * physically travelling to a site office 40 minutes out of town are completely
 * different intent signals, and this is the moment the stronger one becomes
 * true — so it is also the moment the conversion fires.
 */
export async function checkInVisit(formData: FormData) {
  const user = await requirePermission("visits:write");
  const input = z.object({
    leadId: z.string().uuid(),
    visitId: z.preprocess((value) => String(value ?? "").trim() || randomUUID(), z.string().uuid()),
    visitType: z.enum(["corporate_office", "project_site", "experience_centre", "virtual"]),
    accompanying: z.coerce.number().int().min(0).max(20),
    intentRating: z.preprocess((value) => String(value ?? "").trim() || undefined, z.coerce.number().int().min(1).max(5).optional()),
    notes: z.preprocess((value) => String(value ?? "").trim() || undefined, z.string().max(2000).optional()),
    configurationsViewed: z.preprocess((value) => String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean), z.array(z.string().max(120)).max(20)),
    nextAction: z.preprocess((value) => String(value ?? "").trim() || undefined, z.string().max(300).optional()),
    checkInMethod: z.enum(["manual", "qr", "geofence"]),
  }).safeParse({
    leadId: formData.get("leadId"), visitId: formData.get("visitId"),
    visitType: formData.get("visitType") || "corporate_office",
    accompanying: formData.get("accompanyingCount") || 0,
    intentRating: formData.get("intentRating"), notes: formData.get("notes"),
    configurationsViewed: formData.get("configurationsViewed"), nextAction: formData.get("nextAction"),
    checkInMethod: formData.get("checkInMethod") || "manual",
  });
  if (!input.success) throw new Error("Invalid check-in details");
  const { leadId, visitId, visitType, accompanying, intentRating, notes, configurationsViewed, nextAction, checkInMethod } = input.data;

  const db = getDb();
  await db.transaction(async (tx) => {
    if (!(await lockLeadForUpdate(tx, user.orgId, leadId, user))) {
      throw new Error("Lead not found");
    }
    const [lead] = await tx
      .select({
        id: leads.id, personId: leads.personId, projectId: leads.projectId,
        stage: leads.stage, firstTouchpointId: leads.firstTouchpointId,
        attributionExpiresAt: leadTouchpoints.attributionExpiresAt,
      })
      .from(leads)
      .leftJoin(leadTouchpoints, eq(leadTouchpoints.id, leads.firstTouchpointId))
      .where(and(eq(leads.id, leadId), eq(leads.orgId, user.orgId)))
      .limit(1);
    if (!lead) throw new Error("Lead not found");
    if (!lead.projectId) throw new Error("Assign a project before checking in this visitor");

    const now = new Date();

    const inserted = await tx.insert(visits).values({
      id: visitId,
      orgId: user.orgId,
      leadId,
      personId: lead.personId,
      projectId: lead.projectId,
      type: visitType as never,
      status: "arrived",
      arrivedAt: now,
      hostUserId: user.id,
      accompanyingCount: accompanying,
      intentRating: intentRating ?? null,
      configurationsViewed: configurationsViewed.length ? configurationsViewed : null,
      nextAction: nextAction ?? null,
      notes: notes ?? null,
      checkInMethod,
      createdByUserId: user.id,
    }).onConflictDoNothing().returning({ id: visits.id });

    // The form carries a stable visit id. A browser retry or double tap reaches
    // this branch but cannot create a second visit or conversion.
    if (inserted.length === 0) return;

    // Only advance the stage; never pull a negotiating lead back to `visited`
    // just because they came in again.
    const physicalVisit = visitType !== "virtual";
    const shouldAdvance = physicalVisit && ["new", "contacted", "qualified", "visit_scheduled"].includes(lead.stage);
    const resultingLeadStage = shouldAdvance ? "visited" : lead.stage;
    if (shouldAdvance) {
      await tx.insert(leadStageHistory).values({
        id: randomUUID(),
        orgId: user.orgId,
        leadId,
        fromStage: lead.stage,
        toStage: "visited",
        changedByUserId: user.id,
        changedBy: "user",
        reason: "Checked in on site",
      });
      await tx
        .update(leads)
        .set({ stage: "visited", lastActivityAt: now, updatedAt: now })
        .where(eq(leads.id, leadId));
    } else {
      await tx
        .update(leads)
        .set({ lastActivityAt: now, updatedAt: now })
        .where(eq(leads.id, leadId));
    }

    if (physicalVisit) {
      await emitConversionEvent(tx, {
        orgId: user.orgId,
        eventType: visitType === "project_site" ? "site_visit_completed" : "walk_in_completed",
        personId: lead.personId,
        leadId,
        projectId: lead.projectId,
        touchpointId: lead.firstTouchpointId,
        occurredAt: now,
        eventKey: eventKeyFor.visitCompleted(visitId),
        value: await modelledValue(tx, lead.projectId, "visited"),
        stageAtEvent: resultingLeadStage,
        sourceEntityType: "visit",
        sourceEntityId: visitId,
        attributionExpiresAt: lead.attributionExpiresAt,
      });
    }
  });

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/walk-ins");
  revalidatePath("/pipeline");
}

export async function logActivity(formData: FormData) {
  const user = await requirePermission("leads:write");
  const parsed = z.object({
    leadId: z.string().uuid(),
    type: z.enum(["call", "whatsapp", "note", "email", "meeting"]),
    body: z.string().trim().max(5000),
    outcome: z.preprocess((value) => String(value ?? "").trim() || undefined, z.enum(["connected", "no_answer", "busy", "switched_off", "invalid"]).optional()),
    followUp: z.preprocess(
      (value) => String(value ?? "").trim() || undefined,
      localDateTimeSchema.optional(),
    ),
  }).safeParse({ leadId: formData.get("leadId"), type: formData.get("type") || "note", body: formData.get("body") || "", outcome: formData.get("callOutcome"), followUp: formData.get("nextFollowUpAt") });
  if (!parsed.success) throw new Error("Invalid activity details");
  const { leadId, type, body, outcome } = parsed.data;
  const followUp = parsed.data.followUp
    ? parseLocalDateTime(parsed.data.followUp, user.timezone)
    : undefined;
  if (parsed.data.followUp && !followUp) throw new Error("Invalid follow-up time");

  if (!body && !outcome && !followUp) return;

  const db = getDb();
  const now = new Date();

  await db.transaction(async (tx) => {
    if (!(await lockLeadForUpdate(tx, user.orgId, leadId, user))) {
      throw new Error("Lead not found");
    }
    const [lead] = await tx
      .select({ personId: leads.personId })
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.orgId, user.orgId)))
      .limit(1);
    if (!lead) throw new Error("Lead not found");

    if (body || outcome) {
      await tx.insert(activities).values({
        id: randomUUID(), orgId: user.orgId, leadId, personId: lead.personId, type,
        direction: type === "call" ? "outbound" : null, body: body || null,
        callOutcome: outcome ?? null, userId: user.id, occurredAt: now,
      });
    }

    await tx
      .update(leads)
      .set({
        lastActivityAt: now,
        updatedAt: now,
        ...(followUp ? { nextFollowUpAt: followUp } : {}),
      })
      .where(eq(leads.id, leadId));
  });

  revalidatePath(`/leads/${leadId}`);
}

export async function assignLead(formData: FormData) {
  const user = await requirePermission("leads:assign");
  const parsed = z.object({
    leadId: z.string().uuid(),
    toUserId: z.preprocess((value) => String(value ?? "").trim() || null, z.string().uuid().nullable()),
  }).safeParse({ leadId: formData.get("leadId"), toUserId: formData.get("toUserId") });
  if (!parsed.success) throw new Error("Invalid assignment");
  const { leadId, toUserId } = parsed.data;

  const db = getDb();
  await db.transaction(async (tx) => {
    if (!(await lockLeadForUpdate(tx, user.orgId, leadId, user))) {
      throw new Error("Lead not found");
    }
    const [lead] = await tx
      .select({ ownerUserId: leads.ownerUserId })
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.orgId, user.orgId)))
      .limit(1);
    if (!lead) throw new Error("Lead not found");

    if (toUserId) {
      const [assignee] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, toUserId), eq(users.orgId, user.orgId), eq(users.isActive, true)))
        .limit(1);
      if (!assignee) throw new Error("Assignee not found");
    }

    await tx.execute(sql`
      INSERT INTO lead_assignments (id, org_id, lead_id, from_user_id, to_user_id, rule, reason)
      VALUES (${randomUUID()}, ${user.orgId}, ${leadId}, ${lead.ownerUserId}, ${toUserId},
              'manual', 'Reassigned from the dashboard')
    `);

    await tx
      .update(leads)
      .set({ ownerUserId: toUserId, updatedAt: new Date() })
      .where(eq(leads.id, leadId));
  });

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
}
