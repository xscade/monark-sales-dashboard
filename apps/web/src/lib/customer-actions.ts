"use server";

import { randomUUID } from "node:crypto";
import { normalizeIdentity } from "@monark/core";
import {
  auditLogs,
  consentRecords,
  getDb,
  persons,
  personIdentifiers,
} from "@monark/db";
import type { Tx } from "@monark/services";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission, type SessionUser } from "./auth";

async function assertCustomerWriteAccess(tx: Tx, user: SessionUser, personId: string) {
  if (user.role !== "sales_agent") return;
  const owned = await tx.execute(sql`
    SELECT id FROM leads
    WHERE org_id = ${user.orgId}
      AND person_id = ${personId}
      AND owner_user_id = ${user.id}
    LIMIT 1
  `);
  if (!owned.rows[0]) throw new Error("You can only update customers assigned to you");
}

const optionalText = (max: number) =>
  z.preprocess((value) => String(value ?? "").trim() || null, z.string().max(max).nullable());

const customerSchema = z.object({
  personId: z.string().uuid(),
  fullName: optionalText(160),
  primaryPhone: optionalText(40),
  primaryEmail: z.preprocess(
    (value) => String(value ?? "").trim().toLowerCase() || null,
    z.string().email().max(254).nullable(),
  ),
  city: optionalText(100),
  state: optionalText(100),
  postalCode: optionalText(20),
  preferredLanguage: optionalText(60),
  isNri: z.boolean(),
});

function customerPath(personId: string, key: "notice" | "error", value: string) {
  return `/customers/${personId}?${key}=${encodeURIComponent(value)}`;
}

export async function updateCustomer(formData: FormData) {
  const user = await requirePermission("customers:write");
  const parsed = customerSchema.safeParse({
    personId: formData.get("personId"), fullName: formData.get("fullName"),
    primaryPhone: formData.get("primaryPhone"), primaryEmail: formData.get("primaryEmail"),
    city: formData.get("city"), state: formData.get("state"), postalCode: formData.get("postalCode"),
    preferredLanguage: formData.get("preferredLanguage"), isNri: formData.get("isNri") === "on",
  });
  if (!parsed.success) redirect(customerPath(String(formData.get("personId") ?? ""), "error", "Check the customer details"));
  const input = parsed.data;
  const identity = normalizeIdentity({ phone: input.primaryPhone, email: input.primaryEmail, fullName: input.fullName });

  try {
    await getDb().transaction(async (tx) => {
      const [person] = await tx.select({ id: persons.id }).from(persons)
        .where(and(eq(persons.id, input.personId), eq(persons.orgId, user.orgId))).limit(1);
      if (!person) throw new Error("Customer not found");
      await assertCustomerWriteAccess(tx, user, input.personId);

      const identityCandidates = [
        identity.phone ? { type: "phone" as const, value: identity.phone.normalized, hash: identity.phone.hash, raw: identity.phone.raw } : null,
        identity.email ? { type: "email" as const, value: identity.email.normalized, hash: identity.email.hash, raw: identity.email.raw } : null,
      ].filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
        .sort((a, b) => `${a.type}:${a.value}`.localeCompare(`${b.type}:${b.value}`));
      for (const candidate of identityCandidates) {
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`${user.orgId}:${candidate.type}:${candidate.value}`}, 0)
          )
        `);
        const [existing] = await tx.select({ personId: personIdentifiers.personId }).from(personIdentifiers)
          .where(and(eq(personIdentifiers.orgId, user.orgId), eq(personIdentifiers.type, candidate.type), eq(personIdentifiers.valueNormalized, candidate.value))).limit(1);
        if (existing && existing.personId !== input.personId) throw new Error(`That ${candidate.type} already belongs to another customer`);
        await tx.insert(personIdentifiers).values({
          id: randomUUID(), orgId: user.orgId, personId: input.personId, type: candidate.type,
          valueNormalized: candidate.value, valueHash: candidate.hash, valueRaw: candidate.raw,
        }).onConflictDoUpdate({
          target: [personIdentifiers.orgId, personIdentifiers.type, personIdentifiers.valueNormalized],
          set: { lastSeenAt: new Date() },
        });
      }

      await tx.update(persons).set({
        fullName: input.fullName,
        primaryPhone: identity.phone?.normalized ?? null,
        primaryEmail: identity.email?.normalized ?? null,
        city: input.city, state: input.state, postalCode: input.postalCode,
        preferredLanguage: input.preferredLanguage, isNri: input.isNri, updatedAt: new Date(),
      }).where(and(eq(persons.id, input.personId), eq(persons.orgId, user.orgId)));
      await tx.insert(auditLogs).values({
        id: randomUUID(), orgId: user.orgId, actorUserId: user.id, action: "customer.updated",
        entityType: "person", entityId: input.personId,
        after: { fields: ["name", "phone", "email", "location", "language", "nri"] },
      });
    });
  } catch (error) {
    redirect(customerPath(input.personId, "error", error instanceof Error ? error.message : "Customer could not be updated"));
  }
  revalidatePath(`/customers/${input.personId}`);
  revalidatePath("/customers");
  redirect(customerPath(input.personId, "notice", "Customer updated"));
}

const suppressionSchema = z.object({
  personId: z.string().uuid(),
  suppressed: z.boolean(),
  reason: z.preprocess((value) => String(value ?? "").trim() || null, z.string().max(500).nullable()),
});

export async function setCustomerSuppression(formData: FormData) {
  const user = await requirePermission("customers:write");
  const parsed = suppressionSchema.safeParse({
    personId: formData.get("personId"), suppressed: formData.get("suppressed") === "true", reason: formData.get("reason"),
  });
  if (!parsed.success) throw new Error("Invalid suppression request");
  if (parsed.data.suppressed && !parsed.data.reason) redirect(customerPath(parsed.data.personId, "error", "A do-not-contact reason is required"));

  await getDb().transaction(async (tx) => {
    await assertCustomerWriteAccess(tx, user, parsed.data.personId);
    const updated = await tx.update(persons).set({
      isSuppressed: parsed.data.suppressed,
      suppressionReason: parsed.data.suppressed ? parsed.data.reason : null,
      updatedAt: new Date(),
    }).where(and(eq(persons.id, parsed.data.personId), eq(persons.orgId, user.orgId))).returning({ id: persons.id });
    if (!updated.length) throw new Error("Customer not found");

    if (parsed.data.suppressed) {
      await tx.insert(consentRecords).values(["marketing_contact", "ad_user_data", "ad_personalization"].map((purpose) => ({
        id: randomUUID(), orgId: user.orgId, personId: parsed.data.personId, purpose,
        state: "denied" as const, collectedVia: "dashboard suppression", evidence: { reason: parsed.data.reason },
      })));
    }
    await tx.insert(auditLogs).values({
      id: randomUUID(), orgId: user.orgId, actorUserId: user.id,
      action: parsed.data.suppressed ? "customer.suppressed" : "customer.unsuppressed",
      entityType: "person", entityId: parsed.data.personId,
      after: { reason: parsed.data.reason },
    });
  });
  revalidatePath(`/customers/${parsed.data.personId}`);
  revalidatePath("/customers");
  redirect(customerPath(parsed.data.personId, "notice", parsed.data.suppressed ? "Customer marked do not contact" : "Suppression removed; consent was not automatically restored"));
}
