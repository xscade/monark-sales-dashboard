"use server";

import { randomUUID } from "node:crypto";
import {
  auditLogs,
  conversionDestinations,
  conversionEventMappings,
  getDb,
  projects,
} from "@monark/db";
import { encryptCredentials, type Tx } from "@monark/services";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "./auth";
import {
  createDestinationSchema,
  destinationIdSchema,
  destinationSchema,
  mappingIdSchema,
  mappingSchema,
  replaceGoogleCredentialSchema,
  replaceMetaCredentialSchema,
} from "./integration-validation";

const RETURN_TO = "/settings/integrations";
class InputError extends Error {}
const values = (formData: FormData) => Object.fromEntries(formData.entries());
const flash = (key: "notice" | "error", message: string) =>
  `${RETURN_TO}?${new URLSearchParams({ [key]: message })}`;

function parse<T>(result: { success: true; data: T } | { success: false; error: { issues: { message: string }[] } }): T {
  if (!result.success) redirect(flash("error", result.error.issues[0]?.message ?? "Invalid input"));
  return result.data;
}

export async function createDestination(formData: FormData): Promise<void> {
  const actor = await requirePermission("settings:write");
  const input = parse(createDestinationSchema.safeParse(values(formData)));

  try {
    await getDb().transaction(async (tx) => {
      await assertProject(tx, actor.orgId, input.projectId);
      const id = randomUUID();
      const config = input.platform === "meta_capi"
        ? { datasetId: "", apiVersion: "v21.0", testEventCode: null }
        : {
            operatingAccountId: "",
            loginAccountId: null,
            productDestinationId: "",
            accountType: "GOOGLE_ADS",
          };

      await tx.insert(conversionDestinations).values({
        id,
        orgId: actor.orgId,
        name: input.name,
        platform: input.platform,
        projectId: input.projectId,
        config,
        isEnabled: false,
        dryRun: true,
      });
      await tx.insert(auditLogs).values({
        orgId: actor.orgId,
        actorUserId: actor.id,
        action: "destination.created",
        entityType: "conversion_destination",
        entityId: id,
        after: {
          name: input.name,
          platform: input.platform,
          projectId: input.projectId,
          isEnabled: false,
          dryRun: true,
        },
      });
    });
  } catch (error) {
    if (error instanceof InputError) redirect(flash("error", error.message));
    throw error;
  }

  revalidatePath(RETURN_TO);
  revalidatePath("/settings");
  revalidatePath("/conversions");
  redirect(flash("notice", "Destination created in disabled dry-run mode"));
}

async function assertProject(tx: Tx, orgId: string, projectId: string | null) {
  if (!projectId) return;
  const [project] = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId), eq(projects.isActive, true)))
    .limit(1);
  if (!project) throw new InputError("Choose an active project in your organisation");
}

export async function saveDestination(formData: FormData): Promise<void> {
  const actor = await requirePermission("settings:write");
  const input = parse(destinationSchema.safeParse(values(formData)));
  try {
    await getDb().transaction(async (tx) => {
      const [existing] = await tx.select().from(conversionDestinations).where(
        and(eq(conversionDestinations.id, input.id), eq(conversionDestinations.orgId, actor.orgId)),
      ).limit(1);
      if (!existing || existing.platform !== input.platform) throw new InputError("Destination not found");
      await assertProject(tx, actor.orgId, input.projectId);
      const config = input.platform === "meta_capi"
        ? { datasetId: input.datasetId, apiVersion: input.apiVersion, testEventCode: input.testEventCode }
        : { operatingAccountId: input.operatingAccountId, loginAccountId: input.loginAccountId,
            productDestinationId: input.productDestinationId, accountType: input.accountType };
      await tx.update(conversionDestinations).set({
        name: input.name, projectId: input.projectId, config, updatedAt: new Date(),
      }).where(and(eq(conversionDestinations.id, input.id), eq(conversionDestinations.orgId, actor.orgId)));
      await tx.insert(auditLogs).values({
        orgId: actor.orgId, actorUserId: actor.id, action: "destination.config_updated",
        entityType: "conversion_destination", entityId: input.id,
        before: { name: existing.name, projectId: existing.projectId, config: existing.config },
        after: { name: input.name, projectId: input.projectId, config },
      });
    });
  } catch (error) {
    if (error instanceof InputError) redirect(flash("error", error.message));
    throw error;
  }
  revalidatePath(RETURN_TO);
  redirect(flash("notice", "Destination configuration saved"));
}

export async function replaceDestinationCredentials(formData: FormData): Promise<void> {
  const actor = await requirePermission("settings:write");
  const raw = values(formData);
  let input: { id: string; platform: "meta_capi" | "google_data_manager" };
  let credentials: Record<string, unknown>;
  if (raw.platform === "meta_capi") {
    const meta = parse(replaceMetaCredentialSchema.safeParse(raw));
    input = { id: meta.id, platform: meta.platform };
    credentials = { accessToken: meta.accessToken };
  } else {
    const google = parse(replaceGoogleCredentialSchema.safeParse(raw));
    input = { id: google.id, platform: google.platform };
    credentials = google.serviceAccountJson;
  }
  let encrypted: string;
  try {
    encrypted = encryptCredentials(credentials);
  } catch {
    redirect(flash("error", "Credential encryption is not configured"));
  }
  await getDb().transaction(async (tx) => {
    const [destination] = await tx.select({ id: conversionDestinations.id, platform: conversionDestinations.platform })
      .from(conversionDestinations).where(and(
        eq(conversionDestinations.id, input.id), eq(conversionDestinations.orgId, actor.orgId),
      )).limit(1);
    if (!destination || destination.platform !== input.platform) throw new InputError("Destination not found");
    await tx.update(conversionDestinations).set({ credentialsEncrypted: encrypted, updatedAt: new Date() })
      .where(and(eq(conversionDestinations.id, input.id), eq(conversionDestinations.orgId, actor.orgId)));
    await tx.insert(auditLogs).values({
      orgId: actor.orgId, actorUserId: actor.id, action: "destination.credentials_replaced",
      entityType: "conversion_destination", entityId: input.id, after: { replaced: true },
    });
  }).catch((error) => {
    if (error instanceof InputError) redirect(flash("error", error.message));
    throw error;
  });
  revalidatePath(RETURN_TO);
  redirect(flash("notice", "Credentials replaced"));
}

export async function upsertEventMapping(formData: FormData): Promise<void> {
  const actor = await requirePermission("settings:write");
  const input = parse(mappingSchema.safeParse(values(formData)));
  await getDb().transaction(async (tx) => {
    const [destination] = await tx.select({ id: conversionDestinations.id }).from(conversionDestinations)
      .where(and(eq(conversionDestinations.id, input.destinationId), eq(conversionDestinations.orgId, actor.orgId))).limit(1);
    if (!destination) throw new InputError("Destination not found");
    const id = randomUUID();
    const [saved] = await tx.insert(conversionEventMappings).values({
      id, orgId: actor.orgId, destinationId: input.destinationId, eventType: input.eventType,
      platformEventName: input.platformEventName, platformDestinationId: input.platformDestinationId,
      valueStrategy: input.valueStrategy, fixedValue: input.fixedValue == null ? null : String(input.fixedValue),
      isEnabled: input.isEnabled,
    }).onConflictDoUpdate({
      target: [conversionEventMappings.destinationId, conversionEventMappings.eventType],
      set: { platformEventName: input.platformEventName, platformDestinationId: input.platformDestinationId,
        valueStrategy: input.valueStrategy, fixedValue: input.fixedValue == null ? null : String(input.fixedValue),
        isEnabled: input.isEnabled, updatedAt: new Date() },
    }).returning({ id: conversionEventMappings.id });
    await tx.insert(auditLogs).values({
      orgId: actor.orgId, actorUserId: actor.id, action: "event_mapping.upserted",
      entityType: "conversion_event_mapping", entityId: saved?.id ?? id,
      after: { ...input, fixedValue: input.fixedValue },
    });
  }).catch((error) => {
    if (error instanceof InputError) redirect(flash("error", error.message));
    throw error;
  });
  revalidatePath(RETURN_TO);
  redirect(flash("notice", "Event mapping saved"));
}

export async function deleteEventMapping(formData: FormData): Promise<void> {
  const actor = await requirePermission("settings:write");
  const input = parse(mappingIdSchema.safeParse(values(formData)));
  await getDb().transaction(async (tx) => {
    const [mapping] = await tx.select().from(conversionEventMappings).where(and(
      eq(conversionEventMappings.id, input.id), eq(conversionEventMappings.destinationId, input.destinationId),
      eq(conversionEventMappings.orgId, actor.orgId),
    )).limit(1);
    if (!mapping) throw new InputError("Mapping not found");
    await tx.delete(conversionEventMappings).where(and(
      eq(conversionEventMappings.id, input.id), eq(conversionEventMappings.orgId, actor.orgId),
    ));
    await tx.insert(auditLogs).values({
      orgId: actor.orgId, actorUserId: actor.id, action: "event_mapping.deleted",
      entityType: "conversion_event_mapping", entityId: mapping.id, before: mapping,
    });
  }).catch((error) => {
    if (error instanceof InputError) redirect(flash("error", error.message));
    throw error;
  });
  revalidatePath(RETURN_TO);
  redirect(flash("notice", "Event mapping deleted"));
}

export async function validateDestinationConnection(formData: FormData): Promise<void> {
  const actor = await requirePermission("settings:write");
  const input = parse(destinationIdSchema.safeParse(values(formData)));
  const [destination] = await getDb().select().from(conversionDestinations).where(and(
    eq(conversionDestinations.id, input.id), eq(conversionDestinations.orgId, actor.orgId),
  )).limit(1);
  if (!destination) redirect(flash("error", "Destination not found"));
  const config = destination.config as Record<string, unknown>;
  const valid = destination.platform === "meta_capi"
    ? Boolean(config.datasetId && config.apiVersion)
    : destination.platform === "google_data_manager"
      ? Boolean(config.operatingAccountId && config.productDestinationId && config.accountType)
      : false;
  if (!valid || !destination.credentialsEncrypted) redirect(flash("error", "Config or credentials are incomplete"));
  redirect(flash("notice", "Local configuration and encrypted credential checks passed; no live request was sent"));
}
