"use server";

import { getDb } from "@monark/db";
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { stageRank, type LeadStage } from "@monark/core/pipeline";
import { requirePermission } from "./auth";
import { lockLeadForUpdate } from "./lead-lock";
import { checkInVisit, updateLeadProject } from "./actions";
import { parseLocalDateTime } from "./datetime";
import { insertFollowUpTask } from "./follow-up-sync";
import { FOLLOW_UP_CHANNELS } from "./follow-ups";
import { advanceBookingAction, createBookingAction } from "./commercial-actions";
import { scheduleVisit } from "./visit-actions";

/**
 * Workflow-backed stages, performed from the pipeline board.
 *
 * `visit_scheduled`, `visited`, `token_paid` and `booked` cannot be set by
 * dragging a card, because each one is a claim about the real world that has to
 * be backed by evidence — an appointment, an arrival, money. Refusing the drop
 * was correct but useless: it told somebody mid-gesture to go and find another
 * screen, and the lead stayed where it was.
 *
 * These wrappers let the board ask for the missing evidence in place and then
 * run the real workflow, so the guarantee is unchanged — the visit row, the
 * booking row and the conversion event are all still created by the same code
 * that has always created them — while the person never leaves the board.
 */
export interface StageAdvanceState {
  ok: boolean;
  message?: string;
}

export interface StageAdvanceContext {
  leadId: string;
  leadName: string;
  stage: string;
  projectId: string | null;
  projectName: string | null;
  ownerUserId: string | null;
  projects: { id: string; name: string }[];
  agents: { id: string; name: string; role: string }[];
  units: { id: string; label: string; allInPrice: string | null }[];
  /**
   * The booking this lead already has, if any.
   *
   * A lead may hold exactly one live booking, so once a token is on record the
   * way to `booked` is to confirm *that* booking — creating a second one is
   * rejected by the database rules and leaves the board with nowhere to go.
   */
  openBooking: OpenBooking | null;
}

export interface OpenBooking {
  id: string;
  reference: string;
  status: "token" | "booked" | "agreement_signed" | "registered";
  unitLabel: string;
  agreementValue: string | null;
  tokenAmount: string | null;
}

/**
 * Everything the board needs to render a workflow form, fetched when the dialog
 * opens rather than shipped with every card — a board of 400 leads would
 * otherwise carry the full project, agent and unit lists 400 times over.
 */
export async function getStageAdvanceContext(
  leadId: string,
): Promise<StageAdvanceContext | null> {
  const user = await requirePermission("leads:write");
  const parsed = z.string().uuid().safeParse(leadId);
  if (!parsed.success) return null;

  const leadResult = await getDb().execute(sql`
    SELECT l.id, l.stage::text AS stage, l.project_id AS "projectId",
           l.owner_user_id AS "ownerUserId",
           pr.name AS "projectName", p.full_name AS "fullName", l.reference
    FROM leads l
    JOIN persons p ON p.id = l.person_id
    LEFT JOIN projects pr ON pr.id = l.project_id
    WHERE l.org_id = ${user.orgId} AND l.id = ${parsed.data}
      ${user.role === "sales_agent" ? sql`AND l.owner_user_id = ${user.id}` : sql``}
    LIMIT 1
  `);
  const lead = leadResult.rows[0] as
    | {
        id: string;
        stage: string;
        projectId: string | null;
        ownerUserId: string | null;
        projectName: string | null;
        fullName: string | null;
        reference: string;
      }
    | undefined;
  if (!lead) return null;

  const [projectResult, agentResult, unitResult, bookingResult] = await Promise.all([
    getDb().execute(sql`
      SELECT id, name FROM projects
      WHERE org_id = ${user.orgId} AND is_active = true
      ORDER BY name
    `),
    getDb().execute(sql`
      SELECT id, name, role::text AS role FROM users
      WHERE org_id = ${user.orgId} AND is_active = true
        AND role IN ('owner', 'admin', 'sales_manager', 'sales_agent', 'receptionist')
      ORDER BY name
    `),
    lead.projectId
      ? getDb().execute(sql`
          SELECT u.id, u.tower, u.unit_number AS "unitNumber", u.configuration,
                 u.all_in_price AS "allInPrice"
          FROM units u
          WHERE u.org_id = ${user.orgId} AND u.project_id = ${lead.projectId}
            AND u.status = 'available'
            AND NOT EXISTS (
              SELECT 1 FROM unit_holds h
              WHERE h.unit_id = u.id AND h.released_at IS NULL AND h.expires_at > now()
                AND h.lead_id <> ${lead.id}
            )
          ORDER BY u.tower NULLS FIRST, u.unit_number
          LIMIT 300
        `)
      : Promise.resolve({ rows: [] as unknown[] }),
    getDb().execute(sql`
      SELECT b.id, b.reference, b.status::text AS status,
             b.agreement_value AS "agreementValue", b.token_amount AS "tokenAmount",
             u.tower, u.unit_number AS "unitNumber", u.configuration
      FROM bookings b
      LEFT JOIN units u ON u.id = b.unit_id
      WHERE b.org_id = ${user.orgId} AND b.lead_id = ${lead.id} AND b.status <> 'cancelled'
      ORDER BY b.created_at DESC
      LIMIT 1
    `),
  ]);

  const booking = (bookingResult.rows as unknown as {
    id: string;
    reference: string;
    status: OpenBooking["status"];
    agreementValue: string | null;
    tokenAmount: string | null;
    tower: string | null;
    unitNumber: string | null;
    configuration: string | null;
  }[])[0];

  return {
    leadId: lead.id,
    leadName: lead.fullName ?? lead.reference,
    stage: lead.stage,
    projectId: lead.projectId,
    projectName: lead.projectName,
    ownerUserId: lead.ownerUserId,
    projects: projectResult.rows as unknown as { id: string; name: string }[],
    agents: agentResult.rows as unknown as { id: string; name: string; role: string }[],
    units: (unitResult.rows as unknown as {
      id: string;
      tower: string | null;
      unitNumber: string;
      configuration: string;
      allInPrice: string | null;
    }[]).map((unit) => ({
      id: unit.id,
      label: `${[unit.tower, unit.unitNumber].filter(Boolean).join(" · ")} · ${unit.configuration}`,
      allInPrice: unit.allInPrice,
    })),
    openBooking: booking
      ? {
          id: booking.id,
          reference: booking.reference,
          status: booking.status,
          unitLabel: [booking.tower, booking.unitNumber, booking.configuration]
            .filter(Boolean)
            .join(" · "),
          agreementValue: booking.agreementValue,
          tokenAmount: booking.tokenAmount,
        }
      : null,
  };
}

/**
 * Puts the stage where the person dropped the card.
 *
 * Check-in and scheduling only ever move a lead *forward* — they were written
 * for the desk, where a visit never means "go back". Dragging a negotiating
 * lead onto Visited therefore recorded the visit and silently left the card
 * where it was. The workflow has already produced the evidence, so setting the
 * stage here is backed by a real visit row rather than an unbacked edit; a
 * regression still has to say why.
 */
async function alignStageAfterWorkflow(
  leadId: string,
  targetStage: string,
  reason: string | null,
): Promise<string | null> {
  const user = await requirePermission("leads:write");
  try {
    await getDb().transaction(async (tx) => {
      if (!(await lockLeadForUpdate(tx, user.orgId, leadId, user))) {
        throw new Error("Lead not found");
      }
      const result = await tx.execute(sql`
        SELECT stage::text AS stage FROM leads
        WHERE org_id = ${user.orgId} AND id = ${leadId} LIMIT 1
      `);
      const current = (result.rows[0] as { stage: string } | undefined)?.stage;
      if (!current || current === targetStage) return;

      const regression = stageRank(targetStage as LeadStage) < stageRank(current as LeadStage);
      if (regression && !reason) throw new Error("A reason is required to move this lead back");

      await tx.execute(sql`
        INSERT INTO lead_stage_history (id, org_id, lead_id, from_stage, to_stage, changed_by_user_id, changed_by, reason)
        VALUES (${randomUUID()}, ${user.orgId}, ${leadId}, ${current}::lead_stage,
                ${targetStage}::lead_stage, ${user.id}, 'user', ${reason})
      `);
      await tx.execute(sql`
        UPDATE leads SET stage = ${targetStage}::lead_stage, last_activity_at = now(), updated_at = now()
        WHERE org_id = ${user.orgId} AND id = ${leadId}
      `);
    });
  } catch (error) {
    return error instanceof Error ? error.message : "The stage could not be updated";
  }
  revalidatePath("/pipeline");
  revalidatePath(`/leads/${leadId}`);
  return null;
}

/** Reads the target stage the board dropped onto, if the dialog sent one. */
async function applyTargetStage(formData: FormData): Promise<string | null> {
  const targetStage = String(formData.get("targetStage") ?? "").trim();
  const leadId = String(formData.get("leadId") ?? "").trim();
  if (!targetStage || !leadId) return null;
  const reason = String(formData.get("regressionReason") ?? "").trim() || null;
  return alignStageAfterWorkflow(leadId, targetStage, reason);
}

const followUpFields = z.object({
  followUpAt: z.preprocess((value) => String(value ?? "").trim() || undefined, z.string().optional()),
  followUpChannel: z.enum(FOLLOW_UP_CHANNELS).default("call"),
  followUpNote: z.preprocess((value) => String(value ?? "").trim() || undefined, z.string().max(2000).optional()),
  followUpCommitment: z.preprocess((value) => String(value ?? "").trim() || undefined, z.string().max(300).optional()),
});

/**
 * Records the next step for a workflow-driven move.
 *
 * Runs after the workflow rather than inside it: scheduling a visit and taking
 * a token are already transactional, and a mistyped follow-up date must not
 * roll back money that changed hands. A missing follow-up is recoverable from
 * the follow-ups page; a lost booking is not.
 */
async function attachFollowUp(formData: FormData): Promise<string | null> {
  const parsed = followUpFields.safeParse({
    followUpAt: formData.get("followUpAt"),
    followUpChannel: formData.get("followUpChannel") || "call",
    followUpNote: formData.get("followUpNote"),
    followUpCommitment: formData.get("followUpCommitment"),
  });
  if (!parsed.success || !parsed.data.followUpAt) return null;

  const user = await requirePermission("leads:write");
  const at = parseLocalDateTime(parsed.data.followUpAt, user.timezone);
  if (!at) return "The follow-up time was not understood, so no next step was saved";

  const leadId = String(formData.get("leadId") ?? "");
  try {
    await getDb().transaction(async (tx) => {
      const result = await tx.execute(sql`
        SELECT person_id AS "personId", owner_user_id AS "ownerUserId"
        FROM leads WHERE org_id = ${user.orgId} AND id = ${leadId} LIMIT 1
      `);
      const lead = result.rows[0] as { personId: string; ownerUserId: string | null } | undefined;
      if (!lead) throw new Error("Lead not found");
      await insertFollowUpTask(tx, {
        orgId: user.orgId,
        leadId,
        personId: lead.personId,
        assigneeUserId: lead.ownerUserId ?? user.id,
        context: String(formData.get("followUpContext") ?? "next step"),
        followUp: {
          at,
          channel: parsed.data.followUpChannel,
          note: parsed.data.followUpNote ?? null,
          commitment: parsed.data.followUpCommitment ?? null,
        },
      });
    });
  } catch {
    return "Saved, but the follow-up could not be scheduled — add it from the follow-ups page";
  }
  revalidatePath("/follow-ups");
  revalidatePath("/tasks");
  return null;
}

/**
 * The project has to exist before a visit or a booking can reference it, and
 * the board is where its absence is discovered. Setting it here is the same
 * action the lead page uses.
 */
async function ensureProject(formData: FormData): Promise<string | null> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!projectId) return null;
  const leadId = String(formData.get("leadId") ?? "");
  const projectForm = new FormData();
  projectForm.set("leadId", leadId);
  projectForm.set("projectId", projectId);
  try {
    await updateLeadProject(projectForm);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "The project could not be set";
  }
}

export async function scheduleVisitFromBoard(
  _previous: StageAdvanceState,
  formData: FormData,
): Promise<StageAdvanceState> {
  const projectError = await ensureProject(formData);
  if (projectError) return { ok: false, message: projectError };
  const result = await scheduleVisit({ ok: false }, formData);
  if (!result.ok) return { ok: false, message: result.message };
  const stageError = await applyTargetStage(formData);
  if (stageError) return { ok: false, message: stageError };
  const followUpWarning = await attachFollowUp(formData);
  return { ok: true, message: followUpWarning ?? result.message ?? "Visit scheduled" };
}

export async function checkInFromBoard(
  _previous: StageAdvanceState,
  formData: FormData,
): Promise<StageAdvanceState> {
  const projectError = await ensureProject(formData);
  if (projectError) return { ok: false, message: projectError };
  try {
    // Throws on every failure, by design — it is normally a plain form action
    // behind an error boundary. On the board a thrown error would replace the
    // whole screen mid-drag, so it becomes a message instead.
    await checkInVisit(formData);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "The check-in could not be recorded",
    };
  }
  const stageError = await applyTargetStage(formData);
  if (stageError) return { ok: false, message: stageError };
  const followUpWarning = await attachFollowUp(formData);
  return { ok: true, message: followUpWarning ?? "Checked in" };
}

/**
 * `redirect()` reports success by throwing, so it has to reach the framework
 * untouched. Everything else is a business-rule failure that belongs in the
 * dialog next to the field that caused it.
 */
function isRedirect(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

export async function recordBookingFromBoard(
  _previous: StageAdvanceState,
  formData: FormData,
): Promise<StageAdvanceState> {
  // Token payments still need a next step; a confirmed booking does not — the
  // booking itself is the commitment. Skip before createBookingAction because
  // that action redirects by throwing.
  const confirming = formData.get("initialStatus") === "booked";
  if (!confirming) await attachFollowUp(formData);
  try {
    await createBookingAction(formData);
  } catch (error) {
    if (isRedirect(error)) throw error;
    return {
      ok: false,
      message: error instanceof Error ? error.message : "The booking could not be recorded",
    };
  }
  return { ok: true, message: "Booking recorded" };
}

/**
 * Confirms the booking this lead already has, rather than opening a second one.
 *
 * The board asks for `booked` in two quite different situations: a lead with no
 * booking yet, which needs one created, and a lead sitting on a token payment,
 * which needs the existing booking advanced. Both used to run the create path,
 * so the second case failed on "the lead or unit already has an active booking"
 * with no way forward from the board at all.
 */
export async function confirmBookingFromBoard(
  _previous: StageAdvanceState,
  formData: FormData,
): Promise<StageAdvanceState> {
  try {
    await advanceBookingAction(formData);
  } catch (error) {
    if (isRedirect(error)) throw error;
    return {
      ok: false,
      message: error instanceof Error ? error.message : "The booking could not be confirmed",
    };
  }
  return { ok: true, message: "Booking confirmed" };
}

export async function setProjectFromBoard(
  _previous: StageAdvanceState,
  formData: FormData,
): Promise<StageAdvanceState> {
  const projectError = await ensureProject(formData);
  if (projectError) return { ok: false, message: projectError };
  return { ok: true, message: "Project set" };
}
