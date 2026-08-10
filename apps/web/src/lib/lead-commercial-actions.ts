"use server";

import { randomUUID } from "node:crypto";
import {
  activities,
  auditLogs,
  getDb,
  leads,
  leadStageHistory,
  leadTouchpoints,
  unitInterests,
  units,
} from "@monark/db";
import { STAGE_ORDER, type ForwardStage } from "@monark/core";
import { emitConversionEvent, eventKeyFor } from "@monark/services";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "./auth";
import { lockLeadForUpdate } from "./lead-lock";

const shortlistSchema = z.object({
  leadId: z.string().uuid(), unitId: z.string().uuid(),
  notes: z.preprocess((value) => String(value ?? "").trim() || null, z.string().max(500).nullable()),
});

async function loadLeadAndUnit(
  tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  orgId: string,
  leadId: string,
  unitId: string,
) {
  const [row] = await tx.select({
    leadId: leads.id, personId: leads.personId, projectId: leads.projectId, stage: leads.stage,
    touchpointId: leads.firstTouchpointId, attributionExpiresAt: leadTouchpoints.attributionExpiresAt,
    unitId: units.id, unitProjectId: units.projectId, unitNumber: units.unitNumber,
  }).from(leads)
    .innerJoin(units, and(eq(units.orgId, leads.orgId), eq(units.id, unitId)))
    .leftJoin(leadTouchpoints, eq(leadTouchpoints.id, leads.firstTouchpointId))
    .where(and(eq(leads.orgId, orgId), eq(leads.id, leadId))).limit(1);
  if (!row || !row.projectId || row.projectId !== row.unitProjectId) throw new Error("Lead and unit must belong to the same project");
  if (["booked", "lost", "disqualified"].includes(row.stage)) throw new Error("This opportunity is not open");
  return row;
}

export async function addUnitToShortlist(formData: FormData) {
  const user = await requirePermission("leads:write");
  const parsed = shortlistSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Invalid shortlist request");
  const input = parsed.data;
  await getDb().transaction(async (tx) => {
    if (!(await lockLeadForUpdate(tx, user.orgId, input.leadId, user))) {
      throw new Error("Lead not found");
    }
    const context = await loadLeadAndUnit(tx, user.orgId, input.leadId, input.unitId);
    const maxRank = await tx.execute(sql`SELECT COALESCE(MAX(rank), 0)::int AS rank FROM unit_interests WHERE org_id = ${user.orgId} AND lead_id = ${input.leadId}`);
    const id = randomUUID();
    const inserted = await tx.insert(unitInterests).values({
      id, orgId: user.orgId, leadId: input.leadId, unitId: input.unitId,
      rank: Number(maxRank.rows[0]?.rank ?? 0) + 1, notes: input.notes,
    }).onConflictDoNothing().returning({ id: unitInterests.id });
    if (!inserted.length) return;
    const now = new Date();
    await tx.insert(activities).values({
      id: randomUUID(), orgId: user.orgId, leadId: input.leadId, personId: context.personId,
      type: "system", subject: "Unit shortlisted", body: input.notes,
      userId: user.id, occurredAt: now,
      metadata: { kind: "unit_shortlisted", unitId: input.unitId, unitNumber: context.unitNumber },
    });
    await tx.insert(auditLogs).values({
      id: randomUUID(), orgId: user.orgId, actorUserId: user.id, action: "unit.shortlisted",
      entityType: "unit_interest", entityId: id, after: { leadId: input.leadId, unitId: input.unitId },
    });
    await emitConversionEvent(tx, {
      orgId: user.orgId, eventType: "unit_shortlisted", personId: context.personId,
      leadId: input.leadId, projectId: context.projectId, touchpointId: context.touchpointId,
      occurredAt: now, eventKey: eventKeyFor.unitShortlisted(input.leadId, input.unitId),
      stageAtEvent: context.stage, sourceEntityType: "unit_interest", sourceEntityId: id,
      attributionExpiresAt: context.attributionExpiresAt,
    });
  });
  revalidatePath(`/leads/${input.leadId}`);
  revalidatePath("/inventory");
}

export async function removeUnitFromShortlist(formData: FormData) {
  const user = await requirePermission("leads:write");
  const parsed = z.object({ leadId: z.string().uuid(), interestId: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Invalid shortlist request");
  const input = parsed.data;
  await getDb().transaction(async (tx) => {
    if (!(await lockLeadForUpdate(tx, user.orgId, input.leadId, user))) {
      throw new Error("Shortlist entry not found");
    }
    const removed = await tx.delete(unitInterests).where(and(
      eq(unitInterests.id, input.interestId), eq(unitInterests.leadId, input.leadId), eq(unitInterests.orgId, user.orgId),
    )).returning({ id: unitInterests.id, unitId: unitInterests.unitId });
    if (!removed[0]) throw new Error("Shortlist entry not found");
    await tx.insert(auditLogs).values({
      id: randomUUID(), orgId: user.orgId, actorUserId: user.id, action: "unit.shortlist_removed",
      entityType: "unit_interest", entityId: removed[0].id, before: { leadId: input.leadId, unitId: removed[0].unitId },
    });
  });
  revalidatePath(`/leads/${input.leadId}`);
}

const offerSchema = z.object({
  leadId: z.string().uuid(),
  unitId: z.preprocess((value) => String(value ?? "").trim() || null, z.string().uuid().nullable()),
  side: z.enum(["customer", "company"]),
  amount: z.coerce.number().positive().max(1_000_000_000_000),
  status: z.enum(["open", "accepted", "rejected", "withdrawn"]),
  terms: z.preprocess((value) => String(value ?? "").trim() || null, z.string().max(2000).nullable()),
});

export async function recordNegotiationOffer(formData: FormData) {
  const user = await requirePermission("leads:write");
  const parsed = offerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("Invalid negotiation offer");
  const input = parsed.data;
  await getDb().transaction(async (tx) => {
    if (!(await lockLeadForUpdate(tx, user.orgId, input.leadId, user))) {
      throw new Error("Opportunity is not open");
    }
    const [lead] = await tx.select({
      id: leads.id, personId: leads.personId, projectId: leads.projectId, stage: leads.stage,
      touchpointId: leads.firstTouchpointId, attributionExpiresAt: leadTouchpoints.attributionExpiresAt,
    }).from(leads).leftJoin(leadTouchpoints, eq(leadTouchpoints.id, leads.firstTouchpointId))
      .where(and(eq(leads.id, input.leadId), eq(leads.orgId, user.orgId))).limit(1);
    if (!lead || ["booked", "lost", "disqualified"].includes(lead.stage)) throw new Error("Opportunity is not open");
    if (input.unitId) {
      const [unit] = await tx.select({ projectId: units.projectId }).from(units)
        .where(and(eq(units.id, input.unitId), eq(units.orgId, user.orgId))).limit(1);
      if (!unit || unit.projectId !== lead.projectId) throw new Error("Unit is outside this opportunity's project");
    }

    const now = new Date();
    const activityId = randomUUID();
    await tx.insert(activities).values({
      id: activityId, orgId: user.orgId, leadId: lead.id, personId: lead.personId,
      type: "note", subject: `Negotiation · ${input.side} offer · ${input.status}`,
      body: input.terms, userId: user.id, occurredAt: now,
      metadata: { kind: "negotiation_offer", unitId: input.unitId, side: input.side, amount: input.amount, currency: "INR", status: input.status },
    });

    const currentRank = STAGE_ORDER[lead.stage as ForwardStage] ?? -1;
    if (currentRank < STAGE_ORDER.negotiating) {
      await tx.insert(leadStageHistory).values({
        id: randomUUID(), orgId: user.orgId, leadId: lead.id, fromStage: lead.stage,
        toStage: "negotiating", changedByUserId: user.id, changedBy: "user", reason: "Commercial negotiation started",
      });
      await tx.update(leads).set({ stage: "negotiating", lastActivityAt: now, updatedAt: now }).where(eq(leads.id, lead.id));
      await emitConversionEvent(tx, {
        orgId: user.orgId, eventType: "negotiation_started", personId: lead.personId,
        leadId: lead.id, projectId: lead.projectId, touchpointId: lead.touchpointId,
        occurredAt: now, eventKey: eventKeyFor.stageEntered(lead.id, "negotiating"),
        stageAtEvent: "negotiating", sourceEntityType: "activity", sourceEntityId: activityId,
        attributionExpiresAt: lead.attributionExpiresAt,
      });
    } else {
      await tx.update(leads).set({ lastActivityAt: now, updatedAt: now }).where(eq(leads.id, lead.id));
    }
    await tx.insert(auditLogs).values({
      id: randomUUID(), orgId: user.orgId, actorUserId: user.id, action: "negotiation.offer_recorded",
      entityType: "activity", entityId: activityId,
      after: { leadId: lead.id, unitId: input.unitId, side: input.side, amount: input.amount, status: input.status },
    });
  });
  revalidatePath(`/leads/${input.leadId}`);
  revalidatePath("/pipeline");
}
