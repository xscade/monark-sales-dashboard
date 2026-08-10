import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Pipeline stages.
 *
 * Deliberately kept to 8 forward stages plus terminals. Longer ladders look
 * thorough on a whiteboard and then rot in practice: salespeople skip stages,
 * batch-update at end of day, and the funnel maths stops meaning anything.
 * Every downstream signal we send to Meta and Google is derived from these
 * transitions, so stage accuracy is the single biggest input to the whole
 * platform's value. Nuance that does NOT change the funnel position lives in
 * `leadSubStatus` instead.
 */
export const leadStage = pgEnum("lead_stage", [
  "new",
  "contacted",
  "qualified",
  "visit_scheduled",
  "visited",
  "negotiating",
  "token_paid",
  "booked",
  // terminals
  "lost",
  "disqualified",
]);

/**
 * Orthogonal to stage. A lead can be `contacted` + `callback_scheduled`, or
 * `visited` + `awaiting_family_decision`. Changing sub-status never moves the
 * funnel and never emits a conversion event.
 */
export const leadSubStatus = pgEnum("lead_sub_status", [
  "none",
  "contact_attempted",
  "unreachable",
  "callback_scheduled",
  "awaiting_family_decision",
  "awaiting_documents",
  "awaiting_finance_approval",
  "reschedule_requested",
  "on_hold",
]);

/** Why a lead was lost. Feeds the disqualification-reason report and the
 *  suppression logic that stops junk being reported to ad platforms. */
export const lostReason = pgEnum("lost_reason", [
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
]);

export const leadQuality = pgEnum("lead_quality", [
  "unrated",
  "invalid",
  "low",
  "medium",
  "high",
  "very_high",
]);

/** Where a touchpoint physically came from. Distinct from the ad platform. */
export const touchpointSource = pgEnum("touchpoint_source", [
  "website_form",
  "landing_page",
  "meta_lead_ad",
  "google_lead_form",
  "whatsapp",
  "phone_call",
  "walk_in",
  "referral",
  "influencer",
  "broker",
  "csv_import",
  "manual_entry",
  "portal", // 99acres / MagicBricks / Housing
  "other",
]);

export const identifierType = pgEnum("identifier_type", [
  "phone",
  "email",
  "external_id",
  "meta_lead_id",
  "whatsapp_wa_id",
]);

export const visitType = pgEnum("visit_type", [
  "corporate_office",
  "project_site",
  "experience_centre",
  "virtual",
]);

export const visitStatus = pgEnum("visit_status", [
  "scheduled",
  "confirmed",
  "arrived",
  "completed",
  "no_show",
  "cancelled",
]);

/**
 * `token_paid`, `booked` and `registered` are derived states — each one must be
 * backed by a matching booking row, so the availability board and the money
 * never disagree.
 *
 * `sold` is deliberately NOT one of them. It is the manual override for stock
 * that left the pipeline outside this CRM (a channel partner's sale, a legacy
 * agreement, an owner allocation). Keeping it separate rather than reusing
 * `booked` means a report can still answer "how much did we sell through the
 * platform?" without counting units that never had a booking record.
 */
export const unitStatus = pgEnum("unit_status", [
  "available",
  "held",
  "token_paid",
  "booked",
  "registered",
  "blocked",
  "sold",
]);

/**
 * Where a public walk-in link was handed out.
 *
 * This is the channel dimension the walk-in desk never had: a QR code taped to
 * the site office door and a link WhatsApped by a broker produce identical
 * visit rows today, so nobody can tell which channel actually brings buyers.
 */
export const walkInLinkType = pgEnum("walk_in_link_type", [
  "corporate_office",
  "project_site",
  "broker",
  "sales_team",
]);

/**
 * Canonical internal conversion events.
 *
 * These are OUR vocabulary. Adapters map them to Meta event names and Google
 * conversion actions. Business logic must never reference a platform's terms
 * directly — when Meta renames something we change one mapping row, not the
 * pipeline.
 */
export const conversionEventType = pgEnum("conversion_event_type", [
  "lead_created",
  "lead_contacted",
  "lead_qualified",
  "visit_scheduled",
  "walk_in_completed",
  "site_visit_completed",
  "unit_shortlisted",
  "negotiation_started",
  "token_paid",
  "booking_confirmed",
  "sale_completed",
  "booking_cancelled",
  "lead_disqualified",
]);

export const destinationPlatform = pgEnum("destination_platform", [
  "meta_capi",
  "google_data_manager",
  "internal_analytics",
]);

/**
 * Delivery lifecycle for one (conversion_event, destination) pair.
 *
 * `ineligible` is a first-class terminal state, not an error: it means the
 * eligibility gate deliberately withheld the event (no consent, no usable
 * identifier, test lead, known spam). Those must never be retried and must be
 * visibly distinguishable from genuine failures.
 *
 * `expired` means the attribution window closed before we could deliver —
 * tracked separately so the "how much attribution are we losing to the 90-day
 * GCLID wall?" question has a real answer.
 */
export const deliveryStatus = pgEnum("delivery_status", [
  "pending",
  "in_flight",
  "delivered",
  "failed_retryable",
  "failed_permanent",
  "ineligible",
  "expired",
  "skipped_dry_run",
]);

export const consentState = pgEnum("consent_state", [
  "granted",
  "denied",
  "unspecified",
]);

export const userRole = pgEnum("user_role", [
  "owner",
  "admin",
  "marketing",
  "sales_manager",
  "sales_agent",
  "receptionist",
  "read_only",
]);
