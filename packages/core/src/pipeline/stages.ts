export const LEAD_STAGES = [
  "new",
  "contacted",
  "qualified",
  "visit_scheduled",
  "visited",
  "negotiating",
  "token_paid",
  "booked",
] as const;

export const TERMINAL_STAGES = ["lost", "disqualified"] as const;

export type ForwardStage = (typeof LEAD_STAGES)[number];
export type TerminalStage = (typeof TERMINAL_STAGES)[number];
export type LeadStage = ForwardStage | TerminalStage;

/** Ordinal position in the funnel. Terminals sit outside the ordering. */
export const STAGE_ORDER: Record<ForwardStage, number> = {
  new: 0,
  contacted: 1,
  qualified: 2,
  visit_scheduled: 3,
  visited: 4,
  negotiating: 5,
  token_paid: 6,
  booked: 7,
};

export function isTerminal(stage: LeadStage): stage is TerminalStage {
  return (TERMINAL_STAGES as readonly string[]).includes(stage);
}

export function stageRank(stage: LeadStage): number {
  return isTerminal(stage) ? -1 : STAGE_ORDER[stage];
}

/**
 * Stage is a HIGH-WATER MARK, not a checklist.
 *
 * Salespeople skip stages constantly — a walk-in gets checked in without ever
 * being marked `contacted`, because they are standing in the office. Two bad
 * ways to handle this: reject the jump (the CRM fights the user and they stop
 * updating it), or synthesise the missing intermediate events (we fabricate
 * conversions that never happened and feed fiction to the ad platforms).
 *
 * Instead: allow the jump, emit only the event for the stage actually entered,
 * and define funnel reporting as "ever reached stage >= X" computed from
 * lead_stage_history. The funnel stays consistent, nothing is invented, and
 * the CRM never argues with reality.
 */
export function maxStageReached(history: readonly { toStage: LeadStage }[]): ForwardStage {
  let best: ForwardStage = "new";
  for (const row of history) {
    if (isTerminal(row.toStage)) continue;
    if (STAGE_ORDER[row.toStage] > STAGE_ORDER[best]) best = row.toStage;
  }
  return best;
}

export function hasReached(history: readonly { toStage: LeadStage }[], target: ForwardStage): boolean {
  return STAGE_ORDER[maxStageReached(history)] >= STAGE_ORDER[target];
}

export interface TransitionCheck {
  allowed: boolean;
  /** True when the move goes backwards — permitted, but requires a reason and
   *  is surfaced in reporting, since frequent regressions usually indicate
   *  either a process problem or stage misuse. */
  isRegression: boolean;
  requiresReason: boolean;
  reason?: string;
}

/**
 * Transitions are permissive by design. The only hard rules are the ones that
 * protect data integrity rather than enforce process.
 */
export function checkTransition(from: LeadStage, to: LeadStage): TransitionCheck {
  if (from === to) {
    return { allowed: false, isRegression: false, requiresReason: false, reason: "Already in this stage" };
  }

  // Re-opening a closed lead is legitimate (buyers come back), but it must be
  // deliberate and reasoned rather than an accidental dropdown change.
  if (isTerminal(from) && !isTerminal(to)) {
    return { allowed: true, isRegression: false, requiresReason: true };
  }

  if (isTerminal(to)) {
    return { allowed: true, isRegression: false, requiresReason: true };
  }

  // `booked` is a money event backed by a booking record. Rolling it back must
  // go through cancellation, which reverses the booking and emits a
  // `booking_cancelled` event, rather than a silent stage edit.
  if (from === "booked" && !isTerminal(to)) {
    return {
      allowed: false,
      isRegression: true,
      requiresReason: true,
      reason: "Cancel the booking instead of moving the stage backwards",
    };
  }

  const isRegression = stageRank(to) < stageRank(from);
  return { allowed: true, isRegression, requiresReason: isRegression };
}

/**
 * Which internal conversion event a stage entry emits.
 *
 * `visited` maps to nothing here on purpose: whether it becomes
 * `walk_in_completed` or `site_visit_completed` depends on the visit record,
 * and the visit check-in emits it directly. A stage change alone is not
 * evidence that someone physically turned up.
 */
export const STAGE_EVENT_MAP: Partial<Record<ForwardStage, string>> = {
  contacted: "lead_contacted",
  qualified: "lead_qualified",
  visit_scheduled: "visit_scheduled",
  negotiating: "negotiation_started",
  token_paid: "token_paid",
  booked: "booking_confirmed",
};

/** Human labels. Kept next to the machine definition so they cannot drift. */
export const STAGE_LABELS: Record<LeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  visit_scheduled: "Visit Scheduled",
  visited: "Visited",
  negotiating: "Negotiating",
  token_paid: "Token Paid",
  booked: "Booked",
  lost: "Lost",
  disqualified: "Disqualified",
};
