"use server";

import { randomUUID } from "node:crypto";
import { getDb, leads, leadStageHistory, leadTouchpoints, users, visits } from "@monark/db";
import { emitConversionEvent, eventKeyFor } from "@monark/services";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "./auth";
import { localDateTimeSchema, parseLocalDateTime } from "./datetime";
import { lockLeadForUpdate } from "./lead-lock";

export interface VisitActionState {
  ok: boolean;
  message?: string;
}

const scheduleSchema = z.object({
  leadId: z.string().uuid(),
  hostUserId: z.preprocess((value) => String(value ?? "").trim() || undefined, z.string().uuid().optional()),
  type: z.enum(["corporate_office", "project_site", "experience_centre", "virtual"]),
  scheduledAt: localDateTimeSchema,
  notes: z.preprocess((value) => String(value ?? "").trim() || undefined, z.string().max(2000).optional()),
});

export async function scheduleVisit(
  _previous: VisitActionState,
  formData: FormData,
): Promise<VisitActionState> {
  const user = await requirePermission("visits:write");
  const parsed = scheduleSchema.safeParse({
    leadId: formData.get("leadId"),
    hostUserId: formData.get("hostUserId"),
    type: formData.get("type"),
    scheduledAt: formData.get("scheduledAt"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the visit details" };
  const scheduledAt = parseLocalDateTime(parsed.data.scheduledAt, user.timezone);
  if (!scheduledAt) return { ok: false, message: "Choose a valid appointment time" };
  if (scheduledAt.getTime() < Date.now() - 5 * 60_000) {
    return { ok: false, message: "Choose a future appointment time" };
  }

  try {
    await getDb().transaction(async (tx) => {
      if (!(await lockLeadForUpdate(tx, user.orgId, parsed.data.leadId, user))) {
        throw new Error("Lead not found");
      }
      const [lead] = await tx
        .select({
          id: leads.id,
          personId: leads.personId,
          projectId: leads.projectId,
          stage: leads.stage,
          touchpointId: leads.firstTouchpointId,
          attributionExpiresAt: leadTouchpoints.attributionExpiresAt,
        })
        .from(leads)
        .leftJoin(leadTouchpoints, eq(leadTouchpoints.id, leads.firstTouchpointId))
        .where(and(eq(leads.id, parsed.data.leadId), eq(leads.orgId, user.orgId)))
        .limit(1);
      if (!lead || ["booked", "lost", "disqualified"].includes(lead.stage)) throw new Error("Lead is not open");
      if (!lead.projectId) throw new Error("Assign a project before scheduling a visit");

      const hostId = parsed.data.hostUserId ?? user.id;
      const [host] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, hostId), eq(users.orgId, user.orgId), eq(users.isActive, true)))
        .limit(1);
      if (!host) throw new Error("Host is not active");

      const visitId = randomUUID();
      const now = new Date();
      await tx.insert(visits).values({
        id: visitId,
        orgId: user.orgId,
        leadId: lead.id,
        personId: lead.personId,
        projectId: lead.projectId,
        type: parsed.data.type,
        status: "scheduled",
        scheduledAt,
        hostUserId: host.id,
        notes: parsed.data.notes ?? null,
        createdByUserId: user.id,
      });

      const shouldAdvance = ["new", "contacted", "qualified"].includes(lead.stage);
      const resultingLeadStage = shouldAdvance ? "visit_scheduled" : lead.stage;
      if (shouldAdvance) {
        await tx.insert(leadStageHistory).values({
          id: randomUUID(), orgId: user.orgId, leadId: lead.id, fromStage: lead.stage,
          toStage: "visit_scheduled", changedByUserId: user.id, changedBy: "user",
          reason: "Visit scheduled",
        });
        await tx.update(leads).set({ stage: "visit_scheduled", lastActivityAt: now, updatedAt: now }).where(eq(leads.id, lead.id));
      } else {
        await tx.update(leads).set({ lastActivityAt: now, updatedAt: now }).where(eq(leads.id, lead.id));
      }

      await emitConversionEvent(tx, {
        orgId: user.orgId,
        eventType: "visit_scheduled",
        personId: lead.personId,
        leadId: lead.id,
        projectId: lead.projectId,
        touchpointId: lead.touchpointId,
        occurredAt: now,
        eventKey: eventKeyFor.visitScheduled(visitId),
        stageAtEvent: resultingLeadStage,
        sourceEntityType: "visit",
        sourceEntityId: visitId,
        attributionExpiresAt: lead.attributionExpiresAt,
      });
    });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Visit could not be scheduled" };
  }

  revalidatePath("/site-visits");
  revalidatePath(`/leads/${parsed.data.leadId}`);
  return { ok: true, message: "Visit scheduled" };
}

const statusTransitions: Record<string, readonly string[]> = {
  scheduled: ["confirmed", "arrived", "completed", "no_show", "cancelled"],
  confirmed: ["arrived", "completed", "no_show", "cancelled"],
  arrived: ["completed", "cancelled"],
};

const updateSchema = z.object({
  visitId: z.string().uuid(),
  status: z.enum(["confirmed", "arrived", "completed", "no_show", "cancelled"]),
  notes: z.preprocess((value) => String(value ?? "").trim() || undefined, z.string().max(2000).optional()),
});

export async function updateVisitStatus(formData: FormData) {
  const user = await requirePermission("visits:write");
  const parsed = updateSchema.safeParse({ visitId: formData.get("visitId"), status: formData.get("status"), notes: formData.get("notes") });
  if (!parsed.success) throw new Error("Invalid visit update");

  let leadId = "";
  await getDb().transaction(async (tx) => {
    const visitLink = await tx.execute(sql`
      SELECT v.lead_id AS "leadId", v.host_user_id AS "hostUserId",
             l.owner_user_id AS "ownerUserId"
      FROM visits v
      JOIN leads l ON l.id = v.lead_id AND l.org_id = v.org_id
      WHERE v.org_id = ${user.orgId} AND v.id = ${parsed.data.visitId}
      LIMIT 1
    `);
    const link = visitLink.rows[0] as {
      leadId?: string;
      hostUserId?: string | null;
      ownerUserId?: string | null;
    } | undefined;
    const linkedLeadId = String(link?.leadId ?? "");
    const salesAgentMayUpdate = user.role !== "sales_agent" ||
      link?.ownerUserId === user.id || link?.hostUserId === user.id;
    if (!linkedLeadId || !salesAgentMayUpdate || !(await lockLeadForUpdate(tx, user.orgId, linkedLeadId))) {
      throw new Error("Visit not found");
    }
    // Serialize status decisions for this visit. Without the row lock, an
    // arrival and cancellation submitted together could both validate against
    // `scheduled`, leaving a cancelled row while still emitting an arrival.
    const locked = await tx.execute(sql`
      SELECT id FROM visits
      WHERE org_id = ${user.orgId} AND id = ${parsed.data.visitId}
      FOR UPDATE
    `);
    if (!locked.rows[0]) throw new Error("Visit not found");
    const [visit] = await tx
      .select({
        id: visits.id, leadId: visits.leadId, personId: visits.personId, projectId: visits.projectId,
        type: visits.type, status: visits.status, arrivedAt: visits.arrivedAt,
        leadStage: leads.stage, touchpointId: leads.firstTouchpointId,
        attributionExpiresAt: leadTouchpoints.attributionExpiresAt,
      })
      .from(visits)
      .innerJoin(leads, eq(leads.id, visits.leadId))
      .leftJoin(leadTouchpoints, eq(leadTouchpoints.id, leads.firstTouchpointId))
      .where(and(eq(visits.id, parsed.data.visitId), eq(visits.orgId, user.orgId)))
      .limit(1);
    if (!visit || visit.leadId !== linkedLeadId) throw new Error("Visit not found");
    if (!statusTransitions[visit.status]?.includes(parsed.data.status)) throw new Error("That visit status change is not allowed");
    leadId = visit.leadId;

    const now = new Date();
    const isArrival = parsed.data.status === "arrived" || parsed.data.status === "completed";
    const firstPhysicalArrival = isArrival && !visit.arrivedAt && visit.type !== "virtual";
    if (firstPhysicalArrival && !visit.projectId) {
      throw new Error("Assign a project before recording this arrival");
    }
    await tx
      .update(visits)
      .set({
        status: parsed.data.status,
        ...(isArrival && !visit.arrivedAt ? { arrivedAt: now } : {}),
        ...(parsed.data.status === "completed"
          ? {
              departedAt: now,
              durationMinutes: visit.arrivedAt
                ? Math.max(0, Math.round((now.getTime() - new Date(visit.arrivedAt).getTime()) / 60_000))
                : 0,
            }
          : {}),
        ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
        updatedAt: now,
      })
      .where(eq(visits.id, visit.id));

    if (firstPhysicalArrival) {
      const shouldAdvance = ["new", "contacted", "qualified", "visit_scheduled"].includes(visit.leadStage);
      const resultingLeadStage = shouldAdvance ? "visited" : visit.leadStage;
      if (shouldAdvance) {
        await tx.insert(leadStageHistory).values({
          id: randomUUID(), orgId: user.orgId, leadId: visit.leadId, fromStage: visit.leadStage,
          toStage: "visited", changedByUserId: user.id, changedBy: "user", reason: "Visitor arrived",
        });
      }
      await tx
        .update(leads)
        .set({ ...(shouldAdvance ? { stage: "visited" as const } : {}), lastActivityAt: now, updatedAt: now })
        .where(eq(leads.id, visit.leadId));
      await emitConversionEvent(tx, {
        orgId: user.orgId,
        eventType: visit.type === "project_site" ? "site_visit_completed" : "walk_in_completed",
        personId: visit.personId,
        leadId: visit.leadId,
        projectId: visit.projectId,
        touchpointId: visit.touchpointId,
        occurredAt: now,
        eventKey: eventKeyFor.visitCompleted(visit.id),
        stageAtEvent: resultingLeadStage,
        sourceEntityType: "visit",
        sourceEntityId: visit.id,
        attributionExpiresAt: visit.attributionExpiresAt,
      });
    }
  });

  revalidatePath("/site-visits");
  revalidatePath("/today");
  if (leadId) revalidatePath(`/leads/${leadId}`);
}
