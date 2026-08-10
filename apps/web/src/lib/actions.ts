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
import { activities, getDb, leadStageHistory, leads, visits } from "@monark/db";
import { emitConversionEvent, eventKeyFor } from "@monark/services";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireUser } from "./auth";

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

export async function changeStage(formData: FormData) {
  const user = await requireUser();
  const leadId = String(formData.get("leadId"));
  const toStage = String(formData.get("toStage")) as LeadStage;
  const reason = String(formData.get("reason") ?? "").trim() || null;

  const db = getDb();

  await db.transaction(async (tx) => {
    const [lead] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.orgId, user.orgId)))
      .limit(1);
    if (!lead) throw new Error("Lead not found");

    const check = checkTransition(lead.stage as LeadStage, toStage);
    if (!check.allowed) throw new Error(check.reason ?? "Transition not allowed");
    if (check.requiresReason && !reason) throw new Error("A reason is required for this change");

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
        lostReason: null,
        lastActivityAt: now,
        updatedAt: now,
        ...(isFirstContact ? { firstContactedAt: now, firstResponseSeconds } : {}),
        ...(toStage === "booked" || toStage === "lost" || toStage === "disqualified"
          ? { closedAt: now }
          : {}),
      })
      .where(eq(leads.id, leadId));

    const eventType = STAGE_EVENT_MAP[toStage as ForwardStage] as ConversionEventType | undefined;
    if (eventType) {
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
  });

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/pipeline");
  revalidatePath("/leads");
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
  const user = await requireUser();
  const leadId = String(formData.get("leadId"));
  const visitType = String(formData.get("visitType") || "corporate_office");
  const accompanying = Number(formData.get("accompanyingCount") ?? 0) || 0;
  const intentRating = Number(formData.get("intentRating") ?? 0) || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const checkInMethod = String(formData.get("checkInMethod") || "manual");

  const db = getDb();
  const visitId = randomUUID();

  await db.transaction(async (tx) => {
    const [lead] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.orgId, user.orgId)))
      .limit(1);
    if (!lead) throw new Error("Lead not found");

    const now = new Date();

    await tx.insert(visits).values({
      id: visitId,
      orgId: user.orgId,
      leadId,
      personId: lead.personId,
      projectId: lead.projectId,
      type: visitType as never,
      status: "completed",
      arrivedAt: now,
      hostUserId: user.id,
      accompanyingCount: accompanying,
      intentRating,
      notes,
      checkInMethod,
      createdByUserId: user.id,
    });

    // Only advance the stage; never pull a negotiating lead back to `visited`
    // just because they came in again.
    const shouldAdvance = ["new", "contacted", "qualified", "visit_scheduled"].includes(lead.stage);
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

    await emitConversionEvent(tx, {
      orgId: user.orgId,
      eventType:
        visitType === "project_site" ? "site_visit_completed" : "walk_in_completed",
      personId: lead.personId,
      leadId,
      projectId: lead.projectId,
      touchpointId: lead.firstTouchpointId,
      occurredAt: now,
      // Derived from the visit id, so a double-tapped check-in button cannot
      // report two site visits.
      eventKey: eventKeyFor.visitCompleted(visitId),
      value: await modelledValue(tx, lead.projectId, "visited"),
      stageAtEvent: "visited",
      sourceEntityType: "visit",
      sourceEntityId: visitId,
    });
  });

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/walk-ins");
  revalidatePath("/pipeline");
}

export async function logActivity(formData: FormData) {
  const user = await requireUser();
  const leadId = String(formData.get("leadId"));
  const type = String(formData.get("type") || "note");
  const body = String(formData.get("body") ?? "").trim();
  const outcome = String(formData.get("callOutcome") ?? "").trim() || null;
  const followUp = String(formData.get("nextFollowUpAt") ?? "").trim();

  if (!body && !outcome) return;

  const db = getDb();
  const now = new Date();

  await db.transaction(async (tx) => {
    const [lead] = await tx
      .select({ personId: leads.personId })
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.orgId, user.orgId)))
      .limit(1);
    if (!lead) throw new Error("Lead not found");

    await tx.insert(activities).values({
      id: randomUUID(),
      orgId: user.orgId,
      leadId,
      personId: lead.personId,
      type,
      direction: type === "call" ? "outbound" : null,
      body: body || null,
      callOutcome: outcome,
      userId: user.id,
      occurredAt: now,
    });

    await tx
      .update(leads)
      .set({
        lastActivityAt: now,
        updatedAt: now,
        ...(followUp ? { nextFollowUpAt: new Date(followUp) } : {}),
      })
      .where(eq(leads.id, leadId));
  });

  revalidatePath(`/leads/${leadId}`);
}

export async function assignLead(formData: FormData) {
  const user = await requireUser();
  const leadId = String(formData.get("leadId"));
  const toUserId = String(formData.get("toUserId") || "") || null;

  const db = getDb();
  await db.transaction(async (tx) => {
    const [lead] = await tx
      .select({ ownerUserId: leads.ownerUserId })
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.orgId, user.orgId)))
      .limit(1);
    if (!lead) throw new Error("Lead not found");

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
