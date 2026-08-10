"use server";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  apiKeys,
  auditLogs,
  conversionDestinations,
  conversionEventMappings,
  getDb,
  projects,
  users,
} from "@monark/db";
import { encryptCredentials } from "@monark/services";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "./auth";
import {
  createApiKeySchema,
  createProjectSchema,
  firstValidationError,
  inviteUserSchema,
  revokeApiKeySchema,
  setProjectActiveSchema,
  setUserActiveSchema,
  updateDestinationSchema,
  updateProjectSchema,
  updateUserSchema,
  type CreateApiKeyState,
} from "./admin-validation";
import { createAdminClient } from "./supabase/admin";
import { destinationReadinessIssue } from "./integration-validation";

class AdminInputError extends Error {}

function withFlash(path: string, key: "notice" | "error", message: string): string {
  const url = new URL(path, "https://monark.local");
  url.searchParams.set(key, message);
  return `${url.pathname}${url.search}`;
}

function parseForm<T>(
  result: { success: true; data: T } | { success: false; error: import("zod").ZodError },
  returnTo: string,
): T {
  if (!result.success) redirect(withFlash(returnTo, "error", firstValidationError(result.error)));
  return result.data;
}

function redirectOnInputError(error: unknown, returnTo: string): never {
  if (error instanceof AdminInputError) redirect(withFlash(returnTo, "error", error.message));
  throw error;
}

function formValues(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData.entries());
}

export async function inviteUser(formData: FormData): Promise<void> {
  const actor = await requirePermission("settings:write");
  const returnTo = "/settings/users";
  const input = parseForm(inviteUserSchema.safeParse(formValues(formData)), returnTo);
  const db = getDb();

  const duplicate = await db.execute(sql`
    SELECT id, org_id AS "orgId" FROM users WHERE lower(email) = ${input.email} LIMIT 1
  `);
  if (duplicate.rows.length) {
    redirect(withFlash(returnTo, "error", "That email already has CRM access"));
  }

  try {
    const admin = createAdminClient();
    const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listed.error) throw new AdminInputError(`Could not check Auth users: ${listed.error.message}`);
    const existingIdentity = listed.data.users.find(
      (identity) => identity.email?.trim().toLowerCase() === input.email,
    );

    if (!existingIdentity) {
      const appUrl = process.env.APP_URL ??
        (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null);
      if (!appUrl) throw new AdminInputError("APP_URL is required to send a safe invitation link");
      const invitation = await admin.auth.admin.inviteUserByEmail(input.email, {
        redirectTo: `${appUrl.replace(/\/$/, "")}/auth/callback?next=/set-password`,
        data: { name: input.name, invited_by: actor.email },
      });
      if (invitation.error) throw new AdminInputError(`Invitation was not sent: ${invitation.error.message}`);
    }

    await db.transaction(async (tx) => {
      const id = randomUUID();
      await tx.insert(users).values({
        id, orgId: actor.orgId, email: input.email, name: input.name, phone: input.phone,
        role: input.role, languages: input.languages, leadCapacity: String(input.leadCapacity), isActive: true,
      });
      await tx.insert(auditLogs).values({
        orgId: actor.orgId, actorUserId: actor.id,
        action: existingIdentity ? "user.access_granted" : "user.invited",
        entityType: "user", entityId: id,
        after: { email: input.email, name: input.name, role: input.role, languages: input.languages, existingAuthIdentity: Boolean(existingIdentity) },
      });
    });
  } catch (error) {
    if (error instanceof AdminInputError) {
      redirect(withFlash(returnTo, "error", error.message));
    }
    redirect(withFlash(returnTo, "error", "User access could not be created; no CRM access was granted"));
  }

  revalidatePath("/settings");
  revalidatePath(returnTo);
  redirect(withFlash(returnTo, "notice", "User access created; invitation sent when a new Auth identity was needed"));
}

export async function updateUser(formData: FormData): Promise<void> {
  const actor = await requirePermission("settings:write");
  const returnTo = "/settings/users";
  const input = parseForm(updateUserSchema.safeParse(formValues(formData)), returnTo);
  const db = getDb();

  try {
    await db.transaction(async (tx) => {
      const [target] = await tx
        .select({
          id: users.id,
          name: users.name,
          phone: users.phone,
          role: users.role,
          languages: users.languages,
          leadCapacity: users.leadCapacity,
          isActive: users.isActive,
        })
        .from(users)
        .where(and(eq(users.id, input.id), eq(users.orgId, actor.orgId)))
        .limit(1);

      if (!target) throw new AdminInputError("User not found");
      if (target.id === actor.id && target.role !== input.role) {
        throw new AdminInputError("You cannot change your own role");
      }

      if (target.isActive && target.role === "owner" && input.role !== "owner") {
        const owners = await tx.execute(sql`
          SELECT id FROM users
          WHERE org_id = ${actor.orgId} AND role = 'owner' AND is_active = true
          FOR UPDATE
        `);
        if (owners.rows.length <= 1) {
          throw new AdminInputError("Promote another active owner before changing this role");
        }
      }

      const after = {
        name: input.name,
        phone: input.phone,
        role: input.role,
        languages: input.languages,
        leadCapacity: String(input.leadCapacity),
      };

      const changed = await tx
        .update(users)
        .set({ ...after, updatedAt: new Date() })
        .where(and(eq(users.id, target.id), eq(users.orgId, actor.orgId)))
        .returning({ id: users.id });
      if (changed.length !== 1) throw new Error("User update did not affect exactly one row");

      await tx.insert(auditLogs).values({
        orgId: actor.orgId,
        actorUserId: actor.id,
        action: "user.updated",
        entityType: "user",
        entityId: target.id,
        before: {
          name: target.name,
          phone: target.phone,
          role: target.role,
          languages: target.languages,
          leadCapacity: target.leadCapacity,
        },
        after,
      });
    });
  } catch (error) {
    redirectOnInputError(error, returnTo);
  }

  revalidatePath("/settings");
  revalidatePath(returnTo);
  redirect(withFlash(returnTo, "notice", "User updated"));
}

export async function setUserActive(formData: FormData): Promise<void> {
  const actor = await requirePermission("settings:write");
  const returnTo = "/settings/users";
  const input = parseForm(setUserActiveSchema.safeParse(formValues(formData)), returnTo);
  if (input.id === actor.id && !input.isActive) {
    redirect(withFlash(returnTo, "error", "You cannot deactivate your own account"));
  }

  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: users.id, role: users.role, isActive: users.isActive })
        .from(users)
        .where(and(eq(users.id, input.id), eq(users.orgId, actor.orgId)))
        .limit(1);
      if (!target) throw new AdminInputError("User not found");
      if (target.isActive === input.isActive) return;

      if (target.role === "owner" && target.isActive && !input.isActive) {
        const owners = await tx.execute(sql`
          SELECT id FROM users
          WHERE org_id = ${actor.orgId} AND role = 'owner' AND is_active = true
          FOR UPDATE
        `);
        if (owners.rows.length <= 1) {
          throw new AdminInputError(
            "Promote another active owner before deactivating this account",
          );
        }
      }

      const changed = await tx
        .update(users)
        .set({ isActive: input.isActive, updatedAt: new Date() })
        .where(and(eq(users.id, target.id), eq(users.orgId, actor.orgId)))
        .returning({ id: users.id });
      if (changed.length !== 1) {
        throw new Error("User status update did not affect exactly one row");
      }

      await tx.insert(auditLogs).values({
        orgId: actor.orgId,
        actorUserId: actor.id,
        action: input.isActive ? "user.activated" : "user.deactivated",
        entityType: "user",
        entityId: target.id,
        before: { isActive: target.isActive },
        after: { isActive: input.isActive },
      });
    });
  } catch (error) {
    redirectOnInputError(error, returnTo);
  }

  revalidatePath("/settings");
  revalidatePath(returnTo);
  redirect(
    withFlash(returnTo, "notice", input.isActive ? "User reactivated" : "User deactivated"),
  );
}

export async function createProject(formData: FormData): Promise<void> {
  const actor = await requirePermission("settings:write");
  const returnTo = "/settings/projects";
  const input = parseForm(createProjectSchema.safeParse(formValues(formData)), returnTo);
  const db = getDb();

  try {
    await db.transaction(async (tx) => {
      const [duplicate] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.orgId, actor.orgId), eq(projects.slug, input.slug)))
        .limit(1);
      if (duplicate) throw new AdminInputError("A project with this slug already exists");

      const id = randomUUID();
      await tx.insert(projects).values({ id, orgId: actor.orgId, ...input });
      await tx.insert(auditLogs).values({
        orgId: actor.orgId,
        actorUserId: actor.id,
        action: "project.created",
        entityType: "project",
        entityId: id,
        after: input,
      });
    });
  } catch (error) {
    redirectOnInputError(error, returnTo);
  }

  revalidatePath("/settings");
  revalidatePath(returnTo);
  redirect(withFlash(returnTo, "notice", "Project created"));
}

export async function updateProject(formData: FormData): Promise<void> {
  const actor = await requirePermission("settings:write");
  const returnTo = "/settings/projects";
  const input = parseForm(updateProjectSchema.safeParse(formValues(formData)), returnTo);
  const db = getDb();

  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          id: projects.id,
          name: projects.name,
          slug: projects.slug,
          city: projects.city,
          reraNumber: projects.reraNumber,
          avgSaleValue: projects.avgSaleValue,
        })
        .from(projects)
        .where(and(eq(projects.id, input.id), eq(projects.orgId, actor.orgId)))
        .limit(1);
      if (!existing) throw new AdminInputError("Project not found");

      const [duplicate] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.orgId, actor.orgId),
            eq(projects.slug, input.slug),
            ne(projects.id, input.id),
          ),
        )
        .limit(1);
      if (duplicate) throw new AdminInputError("A project with this slug already exists");

      const { id, ...after } = input;
      const changed = await tx
        .update(projects)
        .set({ ...after, updatedAt: new Date() })
        .where(and(eq(projects.id, id), eq(projects.orgId, actor.orgId)))
        .returning({ id: projects.id });
      if (changed.length !== 1) throw new Error("Project update did not affect exactly one row");

      await tx.insert(auditLogs).values({
        orgId: actor.orgId,
        actorUserId: actor.id,
        action: "project.updated",
        entityType: "project",
        entityId: id,
        before: existing,
        after,
      });
    });
  } catch (error) {
    redirectOnInputError(error, returnTo);
  }

  revalidatePath("/settings");
  revalidatePath(returnTo);
  redirect(withFlash(returnTo, "notice", "Project updated"));
}

export async function setProjectActive(formData: FormData): Promise<void> {
  const actor = await requirePermission("settings:write");
  const returnTo = "/settings/projects";
  const input = parseForm(setProjectActiveSchema.safeParse(formValues(formData)), returnTo);
  const db = getDb();

  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: projects.id, isActive: projects.isActive })
        .from(projects)
        .where(and(eq(projects.id, input.id), eq(projects.orgId, actor.orgId)))
        .limit(1);
      if (!existing) throw new AdminInputError("Project not found");
      if (existing.isActive === input.isActive) return;

      const changed = await tx
        .update(projects)
        .set({ isActive: input.isActive, updatedAt: new Date() })
        .where(and(eq(projects.id, existing.id), eq(projects.orgId, actor.orgId)))
        .returning({ id: projects.id });
      if (changed.length !== 1) {
        throw new Error("Project status update did not affect exactly one row");
      }

      await tx.insert(auditLogs).values({
        orgId: actor.orgId,
        actorUserId: actor.id,
        action: input.isActive ? "project.activated" : "project.deactivated",
        entityType: "project",
        entityId: existing.id,
        before: { isActive: existing.isActive },
        after: { isActive: input.isActive },
      });
    });
  } catch (error) {
    redirectOnInputError(error, returnTo);
  }

  revalidatePath("/settings");
  revalidatePath(returnTo);
  revalidatePath("/settings/api");
  redirect(
    withFlash(
      returnTo,
      "notice",
      input.isActive ? "Project reactivated" : "Project deactivated",
    ),
  );
}

export async function createApiKey(
  _previousState: CreateApiKeyState,
  formData: FormData,
): Promise<CreateApiKeyState> {
  const actor = await requirePermission("settings:write");
  const parsed = createApiKeySchema.safeParse(formValues(formData));
  if (!parsed.success) return { status: "error", message: firstValidationError(parsed.error) };
  const input = parsed.data;
  const db = getDb();

  try {
    if (input.projectId) {
      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.id, input.projectId),
            eq(projects.orgId, actor.orgId),
            eq(projects.isActive, true),
          ),
        )
        .limit(1);
      if (!project) throw new AdminInputError("Choose an active project in your organisation");
    }

    const id = randomUUID();
    const keyPrefix = `mk_live_${randomBytes(4).toString("hex")}`;
    const apiKey = `${keyPrefix}_${randomBytes(24).toString("hex")}`;
    const signingSecret = randomBytes(32).toString("hex");
    const keyHash = createHash("sha256").update(apiKey, "utf8").digest("hex");
    const signingSecretEncrypted = encryptCredentials({ secret: signingSecret });

    await db.transaction(async (tx) => {
      await tx.insert(apiKeys).values({
        id,
        orgId: actor.orgId,
        name: input.name,
        keyPrefix,
        keyHash,
        signingSecretEncrypted,
        scopes: ["leads:write"],
        projectId: input.projectId,
        keyPolicy: input.keyPolicy,
        signatureRequired: input.keyPolicy === "server",
        rateLimitPerMinute: String(input.rateLimitPerMinute),
      });
      await tx.insert(auditLogs).values({
        orgId: actor.orgId,
        actorUserId: actor.id,
        action: "api_key.created",
        entityType: "api_key",
        entityId: id,
        after: {
          name: input.name,
          keyPrefix,
          scopes: ["leads:write"],
          projectId: input.projectId,
          keyPolicy: input.keyPolicy,
          signatureRequired: input.keyPolicy === "server",
          rateLimitPerMinute: input.rateLimitPerMinute,
        },
      });
    });

    revalidatePath("/settings");
    revalidatePath("/settings/api");
    return {
      status: "success",
      message:
        input.keyPolicy === "server"
          ? "Server key created. Copy both secrets now; HMAC signing is required."
          : "Browser key created. Copy the bearer key now; the optional signing secret is shown once.",
      apiKey,
      signingSecret,
      keyPrefix,
      keyPolicy: input.keyPolicy,
      signatureRequired: input.keyPolicy === "server",
    };
  } catch (error) {
    if (error instanceof AdminInputError) return { status: "error", message: error.message };
    if (error instanceof Error && error.message.startsWith("CREDENTIALS_ENCRYPTION_KEY")) {
      return { status: "error", message: "Credential encryption is not configured on this server" };
    }
    console.error(
      "API key creation failed",
      error instanceof Error ? error.message : "unknown error",
    );
    return { status: "error", message: "API key creation failed" };
  }
}

export async function revokeApiKey(formData: FormData): Promise<void> {
  const actor = await requirePermission("settings:write");
  const returnTo = "/settings/api";
  const input = parseForm(revokeApiKeySchema.safeParse(formValues(formData)), returnTo);
  const db = getDb();

  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          keyPrefix: apiKeys.keyPrefix,
          revokedAt: apiKeys.revokedAt,
        })
        .from(apiKeys)
        .where(and(eq(apiKeys.id, input.id), eq(apiKeys.orgId, actor.orgId)))
        .limit(1);
      if (!existing) throw new AdminInputError("API key not found");
      if (existing.revokedAt) return;

      const revokedAt = new Date();
      const changed = await tx
        .update(apiKeys)
        .set({ revokedAt })
        .where(
          and(
            eq(apiKeys.id, existing.id),
            eq(apiKeys.orgId, actor.orgId),
            isNull(apiKeys.revokedAt),
          ),
        )
        .returning({ id: apiKeys.id });
      if (changed.length !== 1) {
        throw new Error("API key revocation did not affect exactly one row");
      }

      await tx.insert(auditLogs).values({
        orgId: actor.orgId,
        actorUserId: actor.id,
        action: "api_key.revoked",
        entityType: "api_key",
        entityId: existing.id,
        before: { revokedAt: null },
        after: {
          revokedAt: revokedAt.toISOString(),
          name: existing.name,
          keyPrefix: existing.keyPrefix,
        },
      });
    });
  } catch (error) {
    redirectOnInputError(error, returnTo);
  }

  revalidatePath("/settings");
  revalidatePath(returnTo);
  redirect(withFlash(returnTo, "notice", "API key revoked"));
}

export async function updateDestination(formData: FormData): Promise<void> {
  const actor = await requirePermission("settings:write");
  const returnTo = "/settings";
  const input = parseForm(updateDestinationSchema.safeParse(formValues(formData)), returnTo);
  const db = getDb();

  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          id: conversionDestinations.id,
          platform: conversionDestinations.platform,
          config: conversionDestinations.config,
          credentialsEncrypted: conversionDestinations.credentialsEncrypted,
          isEnabled: conversionDestinations.isEnabled,
          dryRun: conversionDestinations.dryRun,
        })
        .from(conversionDestinations)
        .where(
          and(
            eq(conversionDestinations.id, input.id),
            eq(conversionDestinations.orgId, actor.orgId),
          ),
        )
        .limit(1);
      if (!existing) throw new AdminInputError("Conversion destination not found");

      const beforeValue = input.field === "is_enabled" ? existing.isEnabled : existing.dryRun;
      if (beforeValue === input.value) return;
      const needsDeliveryReadiness =
        (input.field === "is_enabled" && input.value) ||
        (input.field === "dry_run" && !input.value);
      if (needsDeliveryReadiness) {
        if (input.confirmation !== "confirmed") {
          throw new AdminInputError("Confirm that you understand live conversion delivery cannot be retracted");
        }
        const [mapping] = await tx
          .select({ id: conversionEventMappings.id })
          .from(conversionEventMappings)
          .where(and(
            eq(conversionEventMappings.orgId, actor.orgId),
            eq(conversionEventMappings.destinationId, existing.id),
            eq(conversionEventMappings.isEnabled, true),
          ))
          .limit(1);
        const readinessIssue = destinationReadinessIssue({
          platform: existing.platform,
          config: existing.config,
          hasCredentials: Boolean(existing.credentialsEncrypted),
          hasEnabledMapping: Boolean(mapping),
        });
        if (readinessIssue) throw new AdminInputError(readinessIssue);
      }
      const values =
        input.field === "is_enabled"
          ? { isEnabled: input.value, updatedAt: new Date() }
          : { dryRun: input.value, updatedAt: new Date() };

      const changed = await tx
        .update(conversionDestinations)
        .set(values)
        .where(
          and(
            eq(conversionDestinations.id, existing.id),
            eq(conversionDestinations.orgId, actor.orgId),
          ),
        )
        .returning({ id: conversionDestinations.id });
      if (changed.length !== 1) {
        throw new Error("Destination update did not affect exactly one row");
      }

      await tx.insert(auditLogs).values({
        orgId: actor.orgId,
        actorUserId: actor.id,
        action: `destination.${input.field}_changed`,
        entityType: "conversion_destination",
        entityId: existing.id,
        before: { [input.field]: beforeValue },
        after: { [input.field]: input.value },
      });
    });
  } catch (error) {
    redirectOnInputError(error, returnTo);
  }

  revalidatePath(returnTo);
  revalidatePath("/conversions");
  redirect(withFlash(returnTo, "notice", "Destination updated"));
}
