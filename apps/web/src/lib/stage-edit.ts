import { LEAD_STAGES, isTerminal, type ForwardStage, type LeadStage } from "@monark/core/pipeline";

/**
 * The next rung of the funnel, or null at the top and for closed leads.
 *
 * Used to label a "Promote to …" button, so the wording follows the funnel
 * definition rather than being written out again in the UI.
 */
export function nextForwardStage(stage: string): ForwardStage | null {
  if (isTerminal(stage as LeadStage)) return null;
  const index = (LEAD_STAGES as readonly string[]).indexOf(stage);
  if (index === -1 || index >= LEAD_STAGES.length - 1) return null;
  return LEAD_STAGES[index + 1];
}

/**
 * Stages a person may set by hand.
 *
 * Everything omitted here is evidence-backed rather than opinion-backed:
 * `visit_scheduled` needs an appointment, `visited` needs someone physically
 * arriving, `token_paid` and `booked` need money and a booking record. Those
 * stages are written by their own workflows, which also emit the matching
 * conversion event. Letting the board set them directly would report a site
 * visit to Meta that nobody ever made.
 */
export const EDITABLE_STAGES = [
  "new",
  "contacted",
  "qualified",
  "negotiating",
  "lost",
  "disqualified",
] as const;

export type EditableStage = (typeof EDITABLE_STAGES)[number];

/**
 * Workflow stages that may still be set by hand — but only as a regression.
 *
 * Forward entry stays behind the visit/booking forms (those emit the conversion
 * evidence). Dragging a negotiating card back to Visited is a correction, not a
 * new arrival, so the board must be allowed to write the column with a reason
 * rather than opening a check-in that deliberately refuses to pull the stage
 * backwards.
 */
export const REGRESSABLE_STAGES = ["visit_scheduled", "visited"] as const;

export type RegressableStage = (typeof REGRESSABLE_STAGES)[number];

/** Stages `moveLeadStage` will accept — editable ones plus regressable workflow ones. */
export const BOARD_MOVE_STAGES = [...EDITABLE_STAGES, ...REGRESSABLE_STAGES] as const;

export type BoardMoveStage = (typeof BOARD_MOVE_STAGES)[number];

export function isRegressableStage(stage: string): stage is RegressableStage {
  return (REGRESSABLE_STAGES as readonly string[]).includes(stage);
}

export const LOST_REASONS = [
  "not_interested",
  "budget_mismatch",
  "location_mismatch",
  "configuration_mismatch",
  "possession_timeline_mismatch",
  "postponed",
  "no_response",
  "bought_competitor",
  "invalid_contact",
  "duplicate",
  "spam_or_bot",
  "wrong_geography",
  "agent_or_broker",
] as const;

export type LostReason = (typeof LOST_REASONS)[number];

export function isEditableStage(stage: string): stage is EditableStage {
  return (EDITABLE_STAGES as readonly string[]).includes(stage);
}

/** Why a stage cannot be set by hand — shown when a card is dropped on it. */
export const WORKFLOW_STAGE_HINT: Partial<Record<LeadStage, string>> = {
  visit_scheduled: "Schedule the visit to move this lead",
  visited: "Check the visitor in to move this lead",
  token_paid: "Record the token payment to move this lead",
  booked: "Confirm the booking to move this lead",
};
