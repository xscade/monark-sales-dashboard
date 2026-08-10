"use server";

import { getDb } from "@monark/db";
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission, type SessionUser } from "./auth";

type DbTx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

const TEAM_ROLES = new Set(["owner", "admin", "sales_manager"]);

const localDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Choose a valid due date and time")
  .refine((value) => {
    const [datePart, timePart] = value.split("T");
    const [year, month, day] = (datePart ?? "").split("-").map(Number);
    const [hour, minute] = (timePart ?? "").split(":").map(Number);
    if ([year, month, day, hour, minute].some((part) => !Number.isInteger(part))) return false;
    const parsed = new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month! - 1 &&
      parsed.getUTCDate() === day &&
      parsed.getUTCHours() === hour &&
      parsed.getUTCMinutes() === minute
    );
  }, "Choose a valid due date and time");

const createTaskSchema = z.object({
  submissionId: z.string().uuid("Task submission was invalid"),
  leadId: z.string().uuid("Choose a lead"),
  subject: z.string().trim().min(1, "Task title is required").max(200, "Task title is too long"),
  body: z.string().trim().max(5_000, "Task notes are too long").optional(),
  dueAt: localDateTimeSchema,
  assigneeId: z.string().uuid("Choose a valid assignee").optional().or(z.literal("")),
});

const taskIdSchema = z.object({ taskId: z.string().uuid("Task was invalid") });
const rescheduleTaskSchema = taskIdSchema.extend({ dueAt: localDateTimeSchema });

class SalesActionError extends Error {}

function canManageTeam(user: SessionUser): boolean {
  return TEAM_ROLES.has(user.role);
}

function formString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

function safeReturnTo(raw: string, fallback = "/tasks"): string {
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  try {
    const url = new URL(raw, "https://monark.local");
    const allowed =
      url.pathname === "/tasks" ||
      url.pathname === "/today" ||
      url.pathname.startsWith("/leads/") ||
      url.pathname.startsWith("/customers/");
    return allowed ? `${url.pathname}${url.search}` : fallback;
  } catch {
    return fallback;
  }
}

function withFlash(path: string, key: "notice" | "error", message: string): string {
  const url = new URL(path, "https://monark.local");
  url.searchParams.delete(key === "notice" ? "error" : "notice");
  url.searchParams.set(key, message);
  return `${url.pathname}${url.search}`;
}

async function syncLeadNextFollowUp(tx: DbTx, orgId: string, leadId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE leads
    SET next_follow_up_at = (
          SELECT MIN(a.due_at)
          FROM activities a
          WHERE a.org_id = ${orgId}
            AND a.lead_id = ${leadId}
            AND a.type = 'task'
            AND a.completed_at IS NULL
            AND a.due_at IS NOT NULL
        ),
        updated_at = now()
    WHERE org_id = ${orgId} AND id = ${leadId}
  `);
}

function revalidateTaskSurfaces(leadId?: string | null, personId?: string | null): void {
  revalidatePath("/tasks");
  revalidatePath("/today");
  if (leadId) revalidatePath(`/leads/${leadId}`);
  if (personId) revalidatePath(`/customers/${personId}`);
}

export async function createTask(formData: FormData): Promise<void> {
  const user = await requirePermission("tasks:write");
  const returnTo = safeReturnTo(formString(formData, "returnTo"));
  const parsed = createTaskSchema.safeParse({
    submissionId: formString(formData, "submissionId"),
    leadId: formString(formData, "leadId"),
    subject: formString(formData, "subject"),
    body: formString(formData, "body"),
    dueAt: formString(formData, "dueAt"),
    assigneeId: formString(formData, "assigneeId"),
  });

  if (!parsed.success) {
    redirect(withFlash(returnTo, "error", parsed.error.issues[0]?.message ?? "Task was invalid"));
  }

  const input = parsed.data;
  const assigneeId = canManageTeam(user) && input.assigneeId ? input.assigneeId : user.id;
  let personId: string | null = null;

  try {
    await getDb().transaction(async (tx) => {
      const leadResult = await tx.execute(sql`
        SELECT person_id AS "personId", owner_user_id AS "ownerUserId"
        FROM leads
        WHERE org_id = ${user.orgId} AND id = ${input.leadId}
        LIMIT 1
      `);
      const lead = (leadResult.rows as unknown as { personId: string; ownerUserId: string | null }[])[0];
      if (!lead) throw new SalesActionError("Lead not found");
      if (user.role === "sales_agent" && lead.ownerUserId !== user.id) {
        throw new SalesActionError("You can only add tasks to your own leads");
      }
      personId = lead.personId;

      const assigneeResult = await tx.execute(sql`
        SELECT id
        FROM users
        WHERE org_id = ${user.orgId}
          AND id = ${assigneeId}
          AND is_active = true
          AND role IN ('owner', 'admin', 'sales_manager', 'sales_agent', 'receptionist')
        LIMIT 1
      `);
      if (assigneeResult.rows.length === 0) throw new SalesActionError("Assignee is not active");

      await tx.execute(sql`
        INSERT INTO activities (
          id, org_id, lead_id, person_id, type, subject, body,
          due_at, user_id, metadata, occurred_at, created_at
        ) VALUES (
          ${input.submissionId}, ${user.orgId}, ${input.leadId}, ${lead.personId},
          'task', ${input.subject}, ${input.body || null},
          (${input.dueAt}::timestamp AT TIME ZONE ${user.timezone}),
          ${assigneeId}, ${JSON.stringify({ source: "sales_ui" })}::jsonb, now(), now()
        )
        ON CONFLICT (id) DO NOTHING
      `);

      await syncLeadNextFollowUp(tx, user.orgId, input.leadId);
    });
  } catch (error) {
    if (error instanceof SalesActionError) {
      redirect(withFlash(returnTo, "error", error.message));
    }
    throw error;
  }

  revalidateTaskSurfaces(input.leadId, personId);
  redirect(withFlash(returnTo, "notice", "Task created"));
}

export async function completeTask(formData: FormData): Promise<void> {
  const user = await requirePermission("tasks:write");
  const returnTo = safeReturnTo(formString(formData, "returnTo"));
  const parsed = taskIdSchema.safeParse({ taskId: formString(formData, "taskId") });
  if (!parsed.success) {
    redirect(withFlash(returnTo, "error", parsed.error.issues[0]?.message ?? "Task was invalid"));
  }

  let leadId: string | null = null;
  let personId: string | null = null;

  try {
    await getDb().transaction(async (tx) => {
      const result = await tx.execute(sql`
        SELECT lead_id AS "leadId", person_id AS "personId", user_id AS "userId"
        FROM activities
        WHERE org_id = ${user.orgId} AND id = ${parsed.data.taskId} AND type = 'task'
        LIMIT 1
      `);
      const task = (
        result.rows as unknown as Array<{
          leadId: string | null;
          personId: string | null;
          userId: string | null;
        }>
      )[0];
      if (!task) throw new SalesActionError("Task not found");
      if (!canManageTeam(user) && task.userId !== user.id) {
        throw new SalesActionError("You can only complete your own tasks");
      }

      leadId = task.leadId;
      personId = task.personId;
      await tx.execute(sql`
        UPDATE activities
        SET completed_at = COALESCE(completed_at, now())
        WHERE org_id = ${user.orgId} AND id = ${parsed.data.taskId} AND type = 'task'
      `);
      if (task.leadId) await syncLeadNextFollowUp(tx, user.orgId, task.leadId);
    });
  } catch (error) {
    if (error instanceof SalesActionError) {
      redirect(withFlash(returnTo, "error", error.message));
    }
    throw error;
  }

  revalidateTaskSurfaces(leadId, personId);
  redirect(withFlash(returnTo, "notice", "Task completed"));
}

export async function rescheduleTask(formData: FormData): Promise<void> {
  const user = await requirePermission("tasks:write");
  const returnTo = safeReturnTo(formString(formData, "returnTo"));
  const parsed = rescheduleTaskSchema.safeParse({
    taskId: formString(formData, "taskId"),
    dueAt: formString(formData, "dueAt"),
  });
  if (!parsed.success) {
    redirect(withFlash(returnTo, "error", parsed.error.issues[0]?.message ?? "Task was invalid"));
  }

  let leadId: string | null = null;
  let personId: string | null = null;

  try {
    await getDb().transaction(async (tx) => {
      const result = await tx.execute(sql`
        SELECT lead_id AS "leadId", person_id AS "personId",
               user_id AS "userId", completed_at AS "completedAt"
        FROM activities
        WHERE org_id = ${user.orgId} AND id = ${parsed.data.taskId} AND type = 'task'
        LIMIT 1
      `);
      const task = (
        result.rows as unknown as Array<{
          leadId: string | null;
          personId: string | null;
          userId: string | null;
          completedAt: Date | null;
        }>
      )[0];
      if (!task) throw new SalesActionError("Task not found");
      if (!canManageTeam(user) && task.userId !== user.id) {
        throw new SalesActionError("You can only reschedule your own tasks");
      }
      if (task.completedAt) throw new SalesActionError("Completed tasks cannot be rescheduled");

      leadId = task.leadId;
      personId = task.personId;
      await tx.execute(sql`
        UPDATE activities
        SET due_at = (${parsed.data.dueAt}::timestamp AT TIME ZONE ${user.timezone})
        WHERE org_id = ${user.orgId}
          AND id = ${parsed.data.taskId}
          AND type = 'task'
          AND completed_at IS NULL
      `);
      if (task.leadId) await syncLeadNextFollowUp(tx, user.orgId, task.leadId);
    });
  } catch (error) {
    if (error instanceof SalesActionError) {
      redirect(withFlash(returnTo, "error", error.message));
    }
    throw error;
  }

  revalidateTaskSurfaces(leadId, personId);
  redirect(withFlash(returnTo, "notice", "Task rescheduled"));
}
