"use server";

import { randomUUID } from "node:crypto";
import { getDb, leadQualifications, leads, leadStageHistory, leadTouchpoints } from "@monark/db";
import { emitConversionEvent, eventKeyFor } from "@monark/services";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "./auth";
import { lockLeadForUpdate } from "./lead-lock";

const optional = (max: number) => z.preprocess((value) => String(value ?? "").trim() || null, z.string().max(max).nullable());
const schema = z.object({
  leadId: z.string().uuid(),
  quality: z.enum(["unrated", "invalid", "low", "medium", "high", "very_high"]),
  budgetMin: optional(30), budgetMax: optional(30), desiredConfiguration: optional(50),
  purchaseIntent: z.preprocess((v) => String(v ?? "") || null, z.enum(["end_use", "investment", "undecided"]).nullable()),
  purchaseTimeline: z.preprocess((v) => String(v ?? "") || null, z.enum(["immediate", "3_months", "6_months", "12_months", "exploring"]).nullable()),
  fundingMode: z.preprocess((v) => String(v ?? "") || null, z.enum(["self", "home_loan", "mixed"]).nullable()),
  notes: optional(2000),
});

export async function saveQualification(formData: FormData) {
  const user = await requirePermission("leads:write");
  const parsed = schema.safeParse({
    leadId: formData.get("leadId"), quality: formData.get("quality"),
    budgetMin: formData.get("budgetMin"), budgetMax: formData.get("budgetMax"),
    desiredConfiguration: formData.get("desiredConfiguration"), purchaseIntent: formData.get("purchaseIntent"),
    purchaseTimeline: formData.get("purchaseTimeline"), fundingMode: formData.get("fundingMode"), notes: formData.get("notes"),
  });
  if (!parsed.success) throw new Error("Invalid qualification details");
  const input = parsed.data;

  await getDb().transaction(async (tx) => {
    if (!(await lockLeadForUpdate(tx, user.orgId, input.leadId, user))) {
      throw new Error("Lead not found");
    }
    const [lead] = await tx.select({
      id: leads.id, personId: leads.personId, projectId: leads.projectId, stage: leads.stage,
      touchpointId: leads.firstTouchpointId, attributionExpiresAt: leadTouchpoints.attributionExpiresAt,
    }).from(leads).leftJoin(leadTouchpoints, eq(leadTouchpoints.id, leads.firstTouchpointId))
      .where(and(eq(leads.id, input.leadId), eq(leads.orgId, user.orgId))).limit(1);
    if (!lead) throw new Error("Lead not found");

    await tx.insert(leadQualifications).values({
      id: randomUUID(), orgId: user.orgId, leadId: lead.id, quality: input.quality,
      budgetFit: formData.get("budgetFit") === "on", locationFit: formData.get("locationFit") === "on",
      timelineFit: formData.get("timelineFit") === "on", configurationFit: formData.get("configurationFit") === "on",
      isDecisionMaker: formData.get("isDecisionMaker") === "on", budgetMin: input.budgetMin,
      budgetMax: input.budgetMax, desiredConfiguration: input.desiredConfiguration,
      purchaseIntent: input.purchaseIntent, purchaseTimeline: input.purchaseTimeline,
      fundingMode: input.fundingMode, notes: input.notes, ratedByUserId: user.id,
    });

    const shouldAdvance = ["medium", "high", "very_high"].includes(input.quality) && ["new", "contacted"].includes(lead.stage);
    if (shouldAdvance) {
      const now = new Date();
      await tx.insert(leadStageHistory).values({
        id: randomUUID(), orgId: user.orgId, leadId: lead.id, fromStage: lead.stage,
        toStage: "qualified", changedByUserId: user.id, changedBy: "user", reason: `Structured qualification: ${input.quality}`,
      });
      await tx.update(leads).set({ stage: "qualified", lastActivityAt: now, updatedAt: now }).where(eq(leads.id, lead.id));
      await emitConversionEvent(tx, {
        orgId: user.orgId, eventType: "lead_qualified", personId: lead.personId, leadId: lead.id,
        projectId: lead.projectId, touchpointId: lead.touchpointId, occurredAt: now,
        eventKey: eventKeyFor.stageEntered(lead.id, "qualified"), stageAtEvent: "qualified",
        sourceEntityType: "lead", sourceEntityId: lead.id, attributionExpiresAt: lead.attributionExpiresAt,
      });
    }
  });
  revalidatePath(`/leads/${input.leadId}`);
  revalidatePath("/pipeline");
  revalidatePath("/reports");
}
