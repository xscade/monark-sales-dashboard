import type { LeadStage } from "@monark/core/pipeline";

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
