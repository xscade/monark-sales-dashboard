"use server";

import { getDb } from "@monark/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { requirePermission } from "./auth";
import { checkInVisit, updateLeadProject } from "./actions";
import { createBookingAction } from "./commercial-actions";
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

  const [projectResult, agentResult, unitResult] = await Promise.all([
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
  ]);

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
  };
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
  return { ok: result.ok, message: result.message };
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
  return { ok: true, message: "Checked in" };
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

export async function setProjectFromBoard(
  _previous: StageAdvanceState,
  formData: FormData,
): Promise<StageAdvanceState> {
  const projectError = await ensureProject(formData);
  if (projectError) return { ok: false, message: projectError };
  return { ok: true, message: "Project set" };
}
