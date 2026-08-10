/**
 * The eligibility gate.
 *
 * Everything sent to Meta and Google passes through here first. It exists
 * because the failure mode it prevents is invisible and expensive: feed an ad
 * platform events for spam submissions, internal QA tests, and people who never
 * consented, and its bidding model faithfully learns to find you more of
 * exactly that. Performance degrades over weeks, the reports still look fine,
 * and nobody connects the two.
 *
 * A withheld conversion costs one data point. A junk conversion costs
 * optimisation quality that takes a long time to unwind. When in doubt,
 * withhold — and record why, so "why is our Meta volume lower than our CRM
 * lead count?" always has a precise answer.
 */

export type IneligibleReason =
  | "consent_denied"
  | "consent_unknown"
  | "no_usable_identifier"
  | "test_lead"
  | "person_suppressed"
  | "spam_score_exceeded"
  | "attribution_window_expired"
  | "destination_disabled"
  | "event_type_not_mapped"
  | "lead_disqualified_as_invalid";

export interface EligibilityInput {
  consent: {
    adUserData: "granted" | "denied" | "unspecified";
    adPersonalization: "granted" | "denied" | "unspecified";
  };
  identifiers: {
    hasClickId: boolean;
    hasHashedEmail: boolean;
    hasHashedPhone: boolean;
    hasFbp: boolean;
  };
  lead: {
    isTest: boolean;
    spamScore: number;
    /** Disqualification reasons that mean the lead was never a real person. */
    lostReason?: string | null;
  };
  person: { isSuppressed: boolean };
  destination: { isEnabled: boolean; hasMapping: boolean };
  window: { isExpired: boolean };
}

export interface EligibilityResult {
  eligible: boolean;
  reason?: IneligibleReason;
  /** Non-blocking observations, e.g. weak identifier coverage. */
  warnings: string[];
}

export const SPAM_SCORE_THRESHOLD = 70;

/** Disqualification reasons that indicate the "lead" was never a real buyer.
 *  These must never be reported as conversions of any kind. */
const INVALID_LEAD_REASONS = new Set(["spam_or_bot", "invalid_contact", "duplicate"]);

export function checkEligibility(input: EligibilityInput): EligibilityResult {
  const warnings: string[] = [];

  if (!input.destination.isEnabled) {
    return { eligible: false, reason: "destination_disabled", warnings };
  }
  if (!input.destination.hasMapping) {
    return { eligible: false, reason: "event_type_not_mapped", warnings };
  }
  if (input.lead.isTest) {
    return { eligible: false, reason: "test_lead", warnings };
  }
  if (input.person.isSuppressed) {
    return { eligible: false, reason: "person_suppressed", warnings };
  }
  if (input.lead.lostReason && INVALID_LEAD_REASONS.has(input.lead.lostReason)) {
    return { eligible: false, reason: "lead_disqualified_as_invalid", warnings };
  }
  if (input.lead.spamScore >= SPAM_SCORE_THRESHOLD) {
    return { eligible: false, reason: "spam_score_exceeded", warnings };
  }

  // Consent. `adUserData` is the one that governs sending customer data at all;
  // `adPersonalization` narrows what it may be used for and is passed through
  // rather than gating.
  if (input.consent.adUserData === "denied") {
    return { eligible: false, reason: "consent_denied", warnings };
  }
  if (input.consent.adUserData === "unspecified") {
    // Fail closed. An unrecorded consent decision is not a yes, and treating it
    // as one is exactly the assumption that turns into a regulatory problem.
    return { eligible: false, reason: "consent_unknown", warnings };
  }
  if (input.consent.adPersonalization !== "granted") {
    warnings.push("ad_personalization not granted — event usable for measurement only");
  }

  if (input.window.isExpired) {
    return { eligible: false, reason: "attribution_window_expired", warnings };
  }

  const { hasClickId, hasHashedEmail, hasHashedPhone, hasFbp } = input.identifiers;
  if (!hasClickId && !hasHashedEmail && !hasHashedPhone && !hasFbp) {
    return { eligible: false, reason: "no_usable_identifier", warnings };
  }

  // Deliverable, but worth flagging: match rate falls off sharply with thin
  // identifier coverage, and this is the leading indicator of that.
  if (!hasClickId && !hasHashedEmail) {
    warnings.push("no click id and no email — match quality will be limited");
  }
  if (!hasHashedPhone && !hasHashedEmail) {
    warnings.push("no hashed email or phone — relying on click id alone");
  }

  return { eligible: true, warnings };
}

/**
 * Heuristic spam scoring, 0–100.
 *
 * Cheap signals only. This runs at ingestion, must never block a real enquiry,
 * and is intended to flag for review rather than to auto-reject: a false
 * positive here means a genuine ₹3 crore buyer is ignored, which costs far more
 * than the junk lead it filtered.
 */
export function scoreSpam(input: {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  isDisposableEmail?: boolean;
  isRoleAccount?: boolean;
  phoneValid?: boolean;
  submissionsFromIpLastHour?: number;
  timeOnPageSeconds?: number | null;
  userAgent?: string | null;
}): number {
  let score = 0;

  if (input.phoneValid === false) score += 40;
  if (input.isDisposableEmail) score += 35;
  if (input.isRoleAccount) score += 10;

  const name = input.name?.trim() ?? "";
  if (name.length > 0) {
    if (/^(test|asdf|qwerty|abc|xyz|aaa)/i.test(name)) score += 30;
    if (/(.)\1{4,}/.test(name)) score += 20; // "aaaaa"
    if (!/[aeiou]/i.test(name) && name.length > 4) score += 15; // no vowels
  }

  // Form filled implausibly fast — a human cannot read a 4BHK enquiry form and
  // complete it in under three seconds.
  if (input.timeOnPageSeconds != null && input.timeOnPageSeconds < 3) score += 25;

  const burst = input.submissionsFromIpLastHour ?? 0;
  if (burst > 10) score += 40;
  else if (burst > 5) score += 20;

  const ua = input.userAgent?.toLowerCase() ?? "";
  if (ua && /(bot|crawler|spider|headless|python-requests|curl)/.test(ua)) score += 45;

  return Math.min(100, score);
}
