"use server";

import { randomUUID } from "node:crypto";
import { leadAssignments, leads, leadStageHistory, leadTouchpoints, getDb, persons, projects, users, visits } from "@monark/db";
import { emitConversionEvent, eventKeyFor, ingestLead } from "@monark/services";
import { and, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { can, requirePermission } from "./auth";
import { lockLeadForUpdate } from "./lead-lock";

export interface CaptureState {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
  leadId?: string;
}

const optionalText = (max: number) =>
  z.preprocess((value) => {
    const text = String(value ?? "").trim();
    return text.length ? text : undefined;
  }, z.string().max(max).optional());

const optionalList = z.preprocess((value) => {
  const values = String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length ? values : undefined;
}, z.array(z.string().max(120)).max(20).optional());

const contactFields = z.object({
    name: optionalText(160),
    phone: optionalText(40),
    email: z.preprocess((value) => {
      const text = String(value ?? "").trim().toLowerCase();
      return text.length ? text : undefined;
    }, z.string().email("Enter a valid email address").max(254).optional()),
    city: optionalText(100),
    projectId: z.preprocess((value) => String(value ?? "").trim() || undefined, z.string().uuid().optional()),
    ownerUserId: z.preprocess((value) => String(value ?? "").trim() || undefined, z.string().uuid().optional()),
    source: z.enum([
      "manual_entry",
      "phone_call",
      "whatsapp",
      "referral",
      "broker",
      "portal",
      "walk_in",
      "other",
    ]),
    sourceDetail: optionalText(120),
    notes: optionalText(2000),
    preferredLanguage: optionalText(60),
    marketingConsent: z.boolean(),
    adConsent: z.boolean(),
  });

function requireContact(value: { phone?: string; email?: string }, ctx: z.RefinementCtx) {
    if (!value.phone && !value.email) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "Add a phone number or email" });
    }
}

const contactSchema = contactFields.superRefine(requireContact);

function bool(formData: FormData, key: string) {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

function contactPayload(formData: FormData) {
  return {
    name: formData.get("name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    city: formData.get("city"),
    projectId: formData.get("projectId"),
    ownerUserId: formData.get("ownerUserId"),
    source: formData.get("source") || "manual_entry",
    sourceDetail: formData.get("sourceDetail"),
    notes: formData.get("notes"),
    preferredLanguage: formData.get("preferredLanguage"),
    marketingConsent: bool(formData, "marketingConsent"),
    adConsent: bool(formData, "adConsent"),
  };
}

async function validateReferences(orgId: string, projectId?: string, ownerUserId?: string) {
  const db = getDb();
  if (projectId) {
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId), eq(projects.isActive, true)))
      .limit(1);
    if (!project) return "The selected project is not available";
  }
  if (ownerUserId) {
    const [owner] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, ownerUserId),
          eq(users.orgId, orgId),
          eq(users.isActive, true),
          inArray(users.role, ["owner", "admin", "sales_manager", "sales_agent"]),
        ),
      )
      .limit(1);
    if (!owner) return "The selected owner is not available";
  }
  return null;
}

export async function createManualLead(
  _previous: CaptureState,
  formData: FormData,
): Promise<CaptureState> {
  const user = await requirePermission("leads:write");
  const parsed = contactSchema.safeParse(contactPayload(formData));
  if (!parsed.success) {
    return { ok: false, message: "Check the highlighted details", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const input = parsed.data;
  const mayAssignOwner = can(user, "leads:assign");
  const ownerId = mayAssignOwner ? input.ownerUserId : user.id;
  const referenceError = await validateReferences(
    user.orgId,
    input.projectId,
    mayAssignOwner ? ownerId : undefined,
  );
  if (referenceError) return { ok: false, message: referenceError };

  let leadId = "";
  try {
    await getDb().transaction(async (tx) => {
      const result = await ingestLead(tx, {
        orgId: user.orgId,
        projectId: input.projectId,
        name: input.name,
        phone: input.phone,
        email: input.email,
        city: input.city,
        source: input.source,
        sourceDetail: input.sourceDetail,
        notes: input.notes,
        consent: {
          marketing: input.marketingConsent,
          adUserData: input.adConsent,
          adPersonalization: input.adConsent,
          collectedVia: "dashboard manual entry",
        },
        rawPayload: { captureSurface: "dashboard", enteredByUserId: user.id },
      });
      leadId = result.leadId;
      const effectiveOwnerId = mayAssignOwner ? (ownerId ?? null) : user.id;
      // A fresh lead has no owner yet, so lock it without an ownership filter.
      // A matched open lead must already belong to an individual sales agent
      // before that agent may enrich or re-save it. Failing here rolls the
      // entire ingest (including its person/touchpoint writes) back.
      if (!(await lockLeadForUpdate(
        tx,
        user.orgId,
        result.leadId,
        result.isNewLead ? undefined : user,
      ))) {
        throw new Error("Lead not found");
      }
      if (input.preferredLanguage) {
        await tx
          .update(persons)
          .set({ preferredLanguage: input.preferredLanguage, updatedAt: new Date() })
          .where(and(eq(persons.id, result.personId), eq(persons.orgId, user.orgId)));
      }
      await tx
        .update(leads)
        .set({
          ...(result.isNewLead ? { ownerUserId: effectiveOwnerId } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(leads.id, result.leadId), eq(leads.orgId, user.orgId)));
      if (result.isNewLead && effectiveOwnerId) {
        await tx.insert(leadAssignments).values({
          id: randomUUID(), orgId: user.orgId, leadId: result.leadId,
          fromUserId: null, toUserId: effectiveOwnerId, rule: "manual",
          reason: "Assigned during direct capture",
        });
      }
    });
  } catch {
    return { ok: false, message: "The lead could not be saved. Please try again." };
  }

  redirect(`/leads/${leadId}?created=1`);
}

const walkInSchema = contactFields
  .omit({ source: true })
  .extend({
    projectId: z.preprocess(
      (value) => String(value ?? "").trim(),
      z.string().uuid("Choose the project for this visit"),
    ),
    visitId: z.string().uuid(),
    visitType: z.enum(["corporate_office", "project_site", "experience_centre"]),
    accompanyingCount: z.coerce.number().int().min(0).max(20),
    intentRating: z.preprocess(
      (value) => String(value ?? "").trim() || undefined,
      z.coerce.number().int().min(1).max(5).optional(),
    ),
    accompanyingRelations: optionalList,
    configurationsViewed: optionalList,
    unitsViewed: optionalList,
    objections: optionalList,
    nextAction: optionalText(300),
  })
  .superRefine(requireContact);

export async function createFreshWalkIn(
  _previous: CaptureState,
  formData: FormData,
): Promise<CaptureState> {
  const user = await requirePermission("visits:write");
  const parsed = walkInSchema.safeParse({
    ...contactPayload(formData),
    visitId: formData.get("visitId"),
    visitType: formData.get("visitType") || "corporate_office",
    accompanyingCount: formData.get("accompanyingCount") || 0,
    intentRating: formData.get("intentRating"),
    accompanyingRelations: formData.get("accompanyingRelations"),
    configurationsViewed: formData.get("configurationsViewed"),
    unitsViewed: formData.get("unitsViewed"),
    objections: formData.get("objections"),
    nextAction: formData.get("nextAction"),
  });
  if (!parsed.success) {
    return { ok: false, message: "Check the highlighted details", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const input = parsed.data;
  const mayAssignOwner = can(user, "leads:assign");
  const ownerId = mayAssignOwner ? input.ownerUserId : user.id;
  const referenceError = await validateReferences(
    user.orgId,
    input.projectId,
    mayAssignOwner ? ownerId : undefined,
  );
  if (referenceError) return { ok: false, message: referenceError };

  // A queued offline form may have reached the server even if the device lost
  // the response. Its stable visit id makes a retry safely discover the fact
  // already committed instead of recording the arrival twice.
  const [alreadyCaptured] = await getDb()
    .select({ leadId: visits.leadId })
    .from(visits)
    .innerJoin(leads, and(eq(leads.id, visits.leadId), eq(leads.orgId, visits.orgId)))
    .where(and(
      eq(visits.id, input.visitId),
      eq(visits.orgId, user.orgId),
      user.role === "sales_agent" ? eq(leads.ownerUserId, user.id) : undefined,
    ))
    .limit(1);
  if (alreadyCaptured) {
    if (formData.get("offlineSync") === "true") {
      return { ok: true, message: "Offline walk-in already synced", leadId: alreadyCaptured.leadId };
    }
    redirect(`/leads/${alreadyCaptured.leadId}?walkIn=1`);
  }

  let leadId = "";
  try {
    await getDb().transaction(async (tx) => {
      const result = await ingestLead(tx, {
        orgId: user.orgId,
        projectId: input.projectId,
        name: input.name,
        phone: input.phone,
        email: input.email,
        city: input.city,
        source: "walk_in",
        sourceDetail: input.sourceDetail || input.visitType,
        notes: input.notes,
        consent: {
          marketing: input.marketingConsent,
          adUserData: input.adConsent,
          adPersonalization: input.adConsent,
          collectedVia: "walk-in desk",
        },
        rawPayload: { captureSurface: "walk-in desk", enteredByUserId: user.id },
      });
      leadId = result.leadId;
      const visitId = input.visitId;
      const now = new Date();
      const initialOwnerId = mayAssignOwner ? (ownerId ?? null) : user.id;
      if (!(await lockLeadForUpdate(
        tx,
        user.orgId,
        result.leadId,
        result.isNewLead ? undefined : user,
      ))) {
        throw new Error("Lead not found");
      }
      const [lead] = await tx
        .select({
          stage: leads.stage,
          personId: leads.personId,
          projectId: leads.projectId,
          firstTouchpointId: leads.firstTouchpointId,
          firstAttributionExpiresAt: leadTouchpoints.attributionExpiresAt,
        })
        .from(leads)
        .leftJoin(leadTouchpoints, eq(leadTouchpoints.id, leads.firstTouchpointId))
        .where(and(eq(leads.id, result.leadId), eq(leads.orgId, user.orgId)))
        .limit(1);
      if (!lead) throw new Error("Lead disappeared during capture");

      if (input.preferredLanguage) {
        await tx
          .update(persons)
          .set({ preferredLanguage: input.preferredLanguage, updatedAt: now })
          .where(and(eq(persons.id, result.personId), eq(persons.orgId, user.orgId)));
      }

      await tx.insert(visits).values({
        id: visitId,
        orgId: user.orgId,
        leadId: result.leadId,
        personId: result.personId,
        projectId: lead.projectId,
        type: input.visitType,
        status: "arrived",
        arrivedAt: now,
        hostUserId: ownerId ?? user.id,
        accompanyingCount: input.accompanyingCount,
        accompanyingRelations: input.accompanyingRelations ?? null,
        configurationsViewed: input.configurationsViewed ?? null,
        unitsViewed: input.unitsViewed ?? null,
        intentRating: input.intentRating ?? null,
        objections: input.objections ?? null,
        nextAction: input.nextAction ?? null,
        notes: input.notes ?? null,
        checkInMethod: "manual",
        createdByUserId: user.id,
      });

      const shouldAdvance = ["new", "contacted", "qualified", "visit_scheduled"].includes(lead.stage);
      const resultingLeadStage = shouldAdvance ? "visited" : lead.stage;
      if (shouldAdvance) {
        await tx.insert(leadStageHistory).values({
          id: randomUUID(),
          orgId: user.orgId,
          leadId: result.leadId,
          fromStage: lead.stage,
          toStage: "visited",
          changedByUserId: user.id,
          changedBy: "user",
          reason: "Fresh walk-in checked in",
        });
      }
      await tx
        .update(leads)
        .set({
          ...(shouldAdvance ? { stage: "visited" as const } : {}),
          ...(result.isNewLead ? { ownerUserId: initialOwnerId } : {}),
          lastActivityAt: now,
          updatedAt: now,
        })
        .where(eq(leads.id, result.leadId));
      if (result.isNewLead && initialOwnerId) {
        await tx.insert(leadAssignments).values({
          id: randomUUID(), orgId: user.orgId, leadId: result.leadId,
          fromUserId: null, toUserId: initialOwnerId, rule: "manual",
          reason: "Assigned during fresh walk-in capture",
        });
      }

      await emitConversionEvent(tx, {
        orgId: user.orgId,
        eventType: input.visitType === "project_site" ? "site_visit_completed" : "walk_in_completed",
        personId: result.personId,
        leadId: result.leadId,
        projectId: lead.projectId,
        touchpointId: result.isNewLead
          ? result.touchpointId
          : (lead.firstTouchpointId ?? result.touchpointId),
        occurredAt: now,
        eventKey: eventKeyFor.visitCompleted(visitId),
        stageAtEvent: resultingLeadStage,
        sourceEntityType: "visit",
        sourceEntityId: visitId,
        attributionExpiresAt: result.isNewLead
          ? result.attributionExpiresAt
          : (lead.firstAttributionExpiresAt ?? result.attributionExpiresAt),
      });
    });
  } catch {
    return { ok: false, message: "The walk-in could not be saved. The form is still here—please try again." };
  }

  if (formData.get("offlineSync") === "true") {
    return { ok: true, message: "Offline walk-in synced", leadId };
  }
  redirect(`/leads/${leadId}?walkIn=1`);
}
