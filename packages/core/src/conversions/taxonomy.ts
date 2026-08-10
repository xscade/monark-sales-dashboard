import type { ForwardStage } from "../pipeline/stages";

/**
 * The internal conversion event vocabulary.
 *
 * Business logic speaks only this language. Adapters translate it at the edge.
 * The indirection is what keeps a Meta rename or a Google API migration from
 * touching the pipeline — and there has already been one such migration
 * (offline conversion uploads moving out of the Google Ads API into the Data
 * Manager API in June 2026), so this is not hypothetical.
 */
export const CONVERSION_EVENTS = [
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
] as const;

export type ConversionEventType = (typeof CONVERSION_EVENTS)[number];

export interface EventDefinition {
  type: ConversionEventType;
  label: string;
  /** Funnel stage this event corresponds to, for value lookup. */
  stage: ForwardStage | null;
  /**
   * Whether it is sensible to optimise ad delivery on this event.
   *
   * `false` does not mean "don't send it" — bookings are absolutely worth
   * sending for measurement. It means "do not select this as a campaign
   * optimisation goal", either because volume is far too low for a learning
   * phase or because it routinely occurs outside the attribution window.
   */
  suitableForOptimization: boolean;
  /** Typical days from first touch. Used to warn about the 90-day wall. */
  typicalDaysFromLead: number;
  description: string;
}

export const EVENT_DEFINITIONS: Record<ConversionEventType, EventDefinition> = {
  lead_created: {
    type: "lead_created",
    label: "Lead",
    stage: "new",
    suitableForOptimization: true,
    typicalDaysFromLead: 0,
    description:
      "Enquiry received. High volume, weak signal — optimising on this is what produces " +
      "thousands of cheap, worthless form fills.",
  },
  lead_contacted: {
    type: "lead_contacted",
    label: "Lead Contacted",
    stage: "contacted",
    suitableForOptimization: false,
    typicalDaysFromLead: 1,
    description:
      "Salesperson connected. Measures OUR responsiveness more than lead quality, so it is " +
      "a poor optimisation target — a slow sales day would look like a bad campaign.",
  },
  lead_qualified: {
    type: "lead_qualified",
    label: "Qualified Lead",
    stage: "qualified",
    suitableForOptimization: true,
    typicalDaysFromLead: 3,
    description:
      "Meets budget, location and intent criteria. Usually the best starting optimisation " +
      "event: real quality signal, enough volume, comfortably inside every attribution window.",
  },
  visit_scheduled: {
    type: "visit_scheduled",
    label: "Visit Scheduled",
    stage: "visit_scheduled",
    suitableForOptimization: true,
    typicalDaysFromLead: 7,
    description: "Appointment booked. Intent, but no commitment yet — people cancel.",
  },
  walk_in_completed: {
    type: "walk_in_completed",
    label: "Office Walk-in",
    stage: "visited",
    suitableForOptimization: true,
    typicalDaysFromLead: 12,
    description: "Physically attended the corporate office. Strong, verifiable intent.",
  },
  site_visit_completed: {
    type: "site_visit_completed",
    label: "Site Visit",
    stage: "visited",
    suitableForOptimization: true,
    typicalDaysFromLead: 18,
    description:
      "Travelled to the project site. The strongest mid-funnel signal available, and the " +
      "usual graduation target once monthly volume can sustain a learning phase.",
  },
  unit_shortlisted: {
    type: "unit_shortlisted",
    label: "Unit Shortlisted",
    stage: "negotiating",
    suitableForOptimization: false,
    typicalDaysFromLead: 30,
    description: "Specific unit selected. Excellent signal, volume typically too low to bid on.",
  },
  negotiation_started: {
    type: "negotiation_started",
    label: "Negotiation Started",
    stage: "negotiating",
    suitableForOptimization: false,
    typicalDaysFromLead: 40,
    description: "Commercial discussion underway.",
  },
  token_paid: {
    type: "token_paid",
    label: "Token Paid",
    stage: "token_paid",
    suitableForOptimization: false,
    typicalDaysFromLead: 55,
    description: "Money has changed hands. Near-certain booking; send for value calibration.",
  },
  booking_confirmed: {
    type: "booking_confirmed",
    label: "Booking Confirmed",
    stage: "booked",
    suitableForOptimization: false,
    typicalDaysFromLead: 75,
    description:
      "Unit booked — the real outcome. Send it, but do NOT bid on it: volume is a handful " +
      "per month and a meaningful share will fall outside Google's 90-day click window.",
  },
  sale_completed: {
    type: "sale_completed",
    label: "Sale Completed",
    stage: "booked",
    suitableForOptimization: false,
    typicalDaysFromLead: 120,
    description:
      "Agreement signed / registered. Almost always past every attribution window; kept for " +
      "internal reporting and value-model calibration.",
  },
  booking_cancelled: {
    type: "booking_cancelled",
    label: "Booking Cancelled",
    stage: null,
    suitableForOptimization: false,
    typicalDaysFromLead: 90,
    description:
      "Reverses a previously reported booking. Neither platform accepts negative conversions, " +
      "so this is used internally to correct the value model rather than sent as an event.",
  },
  lead_disqualified: {
    type: "lead_disqualified",
    label: "Lead Disqualified",
    stage: null,
    suitableForOptimization: false,
    typicalDaysFromLead: 2,
    description:
      "Junk or invalid. Internal only — its value is in stopping bad leads reaching the ad " +
      "platforms at all, via the eligibility gate.",
  },
};

/** Events that should never leave the building. */
export const INTERNAL_ONLY_EVENTS: ReadonlySet<ConversionEventType> = new Set([
  "booking_cancelled",
  "lead_disqualified",
]);

export function isSendable(type: ConversionEventType): boolean {
  return !INTERNAL_ONLY_EVENTS.has(type);
}

/**
 * Suggested Meta event names.
 *
 * Standard events where the semantics genuinely fit, custom events otherwise.
 * Forcing `Purchase` onto a site visit would let Meta's priors about purchases
 * bleed into a very different behaviour, so the fit has to be real rather than
 * convenient.
 */
export const DEFAULT_META_EVENT_NAMES: Partial<Record<ConversionEventType, string>> = {
  lead_created: "Lead",
  lead_qualified: "QualifiedLead",
  visit_scheduled: "Schedule",
  walk_in_completed: "MonarkWalkIn",
  site_visit_completed: "MonarkSiteVisit",
  unit_shortlisted: "AddToWishlist",
  negotiation_started: "InitiateCheckout",
  token_paid: "AddPaymentInfo",
  booking_confirmed: "Purchase",
  sale_completed: "MonarkSaleCompleted",
};
