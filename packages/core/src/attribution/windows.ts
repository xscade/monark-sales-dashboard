/**
 * Attribution and delivery windows.
 *
 * This module encodes the hardest external constraint the platform operates
 * under, and the reason its whole optimisation strategy is shaped the way it
 * is.
 *
 * ── The 90-day wall ──────────────────────────────────────────────────────
 * Google expires a GCLID 90 days after the click. An offline conversion
 * uploaded after that is silently discarded — not rejected with an error,
 * simply never attributed.
 *
 * A ₹2.5–4 crore apartment does not sell in 90 days. Enquiry → site visit →
 * family decision → finance → token → booking routinely runs 60–180 days. So a
 * large fraction of BOOKINGS will fall outside the window and can never be
 * credited to the click that produced them, no matter how good the CRM is.
 *
 * The consequence is strategic, not technical: you cannot bid on bookings.
 * Optimise delivery on mid-funnel events that reliably land inside 90 days
 * (`lead_qualified`, `site_visit_completed`), and treat bookings as
 * measurement plus value calibration. This is the opposite of the usual
 * e-commerce advice, and it is correct here.
 *
 * ── Meta's 7-day send window ─────────────────────────────────────────────
 * Meta rejects an entire CAPI request if ANY event_time in it is more than
 * 7 days old. Not the offending event — the whole batch. That makes outbox lag
 * a data-loss bug: a queue stuck for a week loses those conversions forever,
 * and one stale event can poison a batch of otherwise-fine ones. Hence the
 * worker batches by age and alerts aggressively on lag.
 */

/** Google's GCLID lifespan. Uploads past this are dropped. */
export const GOOGLE_CLICK_WINDOW_DAYS = 90;

/** Meta rejects the whole request if any event_time exceeds this. */
export const META_EVENT_TIME_MAX_AGE_DAYS = 7;

/** Safety margin so we stop trying before the true deadline rather than at it. */
export const DELIVERY_SAFETY_MARGIN_HOURS = 12;

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * When Google stops attributing conversions for this touchpoint.
 *
 * Runs from the CLICK, not from when the CRM received the lead. Those differ
 * whenever a lead is imported late, a portal delivers in batch, or a Meta Lead
 * Ads webhook is replayed — and using receipt time would overstate the
 * remaining window and cause silent drops.
 */
export function computeAttributionExpiry(params: {
  clickedAt?: Date | null;
  occurredAt: Date;
  hasGoogleClickId: boolean;
}): Date | null {
  if (!params.hasGoogleClickId) return null;
  const anchor = params.clickedAt ?? params.occurredAt;
  return addDays(anchor, GOOGLE_CLICK_WINDOW_DAYS);
}

export interface AttributionClock {
  expiresAt: Date | null;
  daysRemaining: number | null;
  /** Nudge sales that the ad-platform feedback loop is about to close. */
  isExpiringSoon: boolean;
  isExpired: boolean;
}

export function attributionClock(expiresAt: Date | null, now = new Date()): AttributionClock {
  if (!expiresAt) {
    return { expiresAt: null, daysRemaining: null, isExpiringSoon: false, isExpired: false };
  }
  const daysRemaining = Math.floor((expiresAt.getTime() - now.getTime()) / DAY_MS);
  return {
    expiresAt,
    daysRemaining,
    isExpiringSoon: daysRemaining <= 14 && daysRemaining > 0,
    isExpired: daysRemaining <= 0,
  };
}

/**
 * Latest useful moment to deliver a given conversion event.
 *
 * Takes the earlier of the two independent clocks, minus a safety margin.
 * Deliveries past this become `expired` rather than `failed`, which keeps the
 * distinction between "we broke" and "physics" visible in reporting.
 */
export function computeDeliverBy(params: {
  platform: "meta_capi" | "google_data_manager" | "internal_analytics";
  eventOccurredAt: Date;
  attributionExpiresAt?: Date | null;
}): Date | null {
  const margin = DELIVERY_SAFETY_MARGIN_HOURS * 60 * 60 * 1000;

  if (params.platform === "meta_capi") {
    return new Date(
      addDays(params.eventOccurredAt, META_EVENT_TIME_MAX_AGE_DAYS).getTime() - margin,
    );
  }

  if (params.platform === "google_data_manager") {
    // Bounded by the click window when a click id is present; otherwise
    // enhanced-conversion matching on hashed email/phone applies and there is
    // no equivalent hard client-side deadline, so we do not impose one.
    return params.attributionExpiresAt
      ? new Date(params.attributionExpiresAt.getTime() - margin)
      : null;
  }

  return null;
}

/** Meta will reject the request outright — never even attempt it. */
export function isTooOldForMeta(eventOccurredAt: Date, now = new Date()): boolean {
  return now.getTime() - eventOccurredAt.getTime() > META_EVENT_TIME_MAX_AGE_DAYS * DAY_MS;
}

/**
 * Expected share of bookings that will still be inside Google's window, given
 * a cycle-length distribution.
 *
 * Powers the "attribution loss" figure on the dashboard. Being explicit about
 * this number up front prevents the far worse outcome: someone concluding six
 * months from now that Google "doesn't work" because reported bookings are a
 * fraction of real ones.
 */
export function estimateAttributableShare(
  daysToBooking: readonly number[],
): { attributable: number; total: number; share: number } {
  const total = daysToBooking.length;
  if (total === 0) return { attributable: 0, total: 0, share: 0 };
  const attributable = daysToBooking.filter((d) => d <= GOOGLE_CLICK_WINDOW_DAYS).length;
  return { attributable, total, share: attributable / total };
}
