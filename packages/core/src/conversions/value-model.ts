import { LEAD_STAGES, STAGE_ORDER, type ForwardStage } from "../pipeline/stages";

/**
 * Conversion value modelling.
 *
 * The tempting shortcut is to invent a ladder — lead ₹1, walk-in ₹100, booking
 * ₹10,000 — and ship it. Those numbers are not wrong in the sense of being
 * slightly off; they describe an economy that does not exist, and value-based
 * bidding will optimise against them with complete confidence.
 *
 * What is actually wanted is:
 *
 *     value(stage) = P(booking | reached stage) × expected sale value
 *
 * which makes every event denominated in the same unit — expected rupees of
 * revenue — so Meta and Google can trade them off against each other honestly.
 *
 * ── Why not just divide ──────────────────────────────────────────────────
 * At real-estate volumes the raw ratio is unusable. Three site visits and one
 * booking is not a 33% conversion rate, it is four data points. So observed
 * rates are shrunk toward a prior using a Beta-Binomial posterior mean:
 *
 *     p̂ = (successes + α) / (trials + α + β)
 *
 * With few trials the estimate sits near the prior; as evidence accumulates it
 * moves toward the observed rate. Nothing exotic — just the difference between
 * a number that stabilises and one that swings wildly month to month and drags
 * your bidding with it.
 */

/**
 * Priors: P(booking | reached stage) before any of your own data exists.
 *
 * Calibrated for premium residential real estate with a long, high-touch cycle.
 * They are starting points, not truth — the whole point is that they get
 * replaced by Monark's own history. Deliberately conservative: overstating
 * early-stage value teaches the platforms that cheap leads are valuable, which
 * is the exact mistake this system exists to prevent.
 */
export const DEFAULT_STAGE_PRIORS: Record<ForwardStage, number> = {
  new: 0.004,
  contacted: 0.008,
  qualified: 0.025,
  visit_scheduled: 0.06,
  visited: 0.14,
  negotiating: 0.4,
  token_paid: 0.85,
  booked: 1.0,
};

/** Prior strength, in pseudo-observations. ~40 means roughly 40 real leads at a
 *  stage before the data outweighs the prior — about right when a stage sees a
 *  few dozen leads a month and you want quarterly stability. */
export const PRIOR_STRENGTH = 40;

export interface StageObservation {
  stage: ForwardStage;
  /** Leads that ever reached this stage (high-water mark). */
  reached: number;
  /** Of those, how many went on to `booked`. */
  converted: number;
  medianDaysToBooking?: number | null;
}

export interface StageValue {
  stage: ForwardStage;
  probabilityToBooking: number;
  observedRate: number | null;
  sampleSize: number;
  expectedValue: number;
  medianDaysToBooking: number | null;
  /** How much of the estimate comes from real data vs the prior, 0–1.
   *  Surfaced in the UI so nobody treats a prior-driven number as measured. */
  evidenceWeight: number;
}

/**
 * Beta-Binomial posterior mean, with the prior expressed as
 * (mean, strength) rather than raw α/β because that is the form a human can
 * actually reason about.
 */
export function shrinkRate(
  successes: number,
  trials: number,
  priorMean: number,
  priorStrength = PRIOR_STRENGTH,
): number {
  const alpha = priorMean * priorStrength;
  const beta = (1 - priorMean) * priorStrength;
  return (successes + alpha) / (trials + alpha + beta);
}

export function computeStageValues(params: {
  observations: readonly StageObservation[];
  expectedSaleValue: number;
  priors?: Partial<Record<ForwardStage, number>>;
  priorStrength?: number;
}): StageValue[] {
  const priors = { ...DEFAULT_STAGE_PRIORS, ...params.priors };
  const strength = params.priorStrength ?? PRIOR_STRENGTH;
  const byStage = new Map(params.observations.map((o) => [o.stage, o]));

  const raw = LEAD_STAGES.map((stage): StageValue => {
    const obs = byStage.get(stage);
    const reached = obs?.reached ?? 0;
    const converted = obs?.converted ?? 0;
    const priorMean = priors[stage] ?? DEFAULT_STAGE_PRIORS[stage];

    const probability =
      stage === "booked" ? 1 : shrinkRate(converted, reached, priorMean, strength);

    return {
      stage,
      probabilityToBooking: probability,
      observedRate: reached > 0 ? converted / reached : null,
      sampleSize: reached,
      expectedValue: round2(probability * params.expectedSaleValue),
      medianDaysToBooking: obs?.medianDaysToBooking ?? null,
      evidenceWeight: reached / (reached + strength),
    };
  });

  return enforceMonotonicity(raw, params.expectedSaleValue);
}

/**
 * Force P(booking | stage) to be non-decreasing along the funnel.
 *
 * A lead that has paid a token cannot be less likely to book than one that has
 * merely visited. Sampling noise at low volume will nonetheless produce
 * inversions, and an inverted value ladder actively teaches the ad platforms
 * that deeper funnel stages are worth *less* — a genuinely damaging signal.
 *
 * Isotonic-style pass: sweep from the deepest stage backwards, clamping each
 * stage to at most its successor's probability.
 */
function enforceMonotonicity(values: StageValue[], expectedSaleValue: number): StageValue[] {
  const sorted = [...values].sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage]);

  for (let i = sorted.length - 2; i >= 0; i--) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (!current || !next) continue;
    if (current.probabilityToBooking > next.probabilityToBooking) {
      current.probabilityToBooking = next.probabilityToBooking;
      current.expectedValue = round2(current.probabilityToBooking * expectedSaleValue);
    }
  }
  return sorted;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Which event to optimise ad delivery on.
 *
 * The deepest stage that satisfies three conditions at once:
 *   1. enough monthly volume for the platform's learning phase to converge,
 *   2. a median time-to-event inside Google's 90-day click window,
 *   3. a strong enough correlation with booking to be worth chasing.
 *
 * This is the recommendation that stops someone optimising campaigns on six
 * bookings a year and wondering why delivery is erratic — and it is exactly the
 * decision that should be re-made from data every quarter rather than set once.
 */
export function recommendOptimizationEvent(params: {
  stageValues: readonly StageValue[];
  monthlyVolumeByStage: Partial<Record<ForwardStage, number>>;
  /** Platform learning phase needs roughly this many events per month. */
  minMonthlyEvents?: number;
  maxMedianDays?: number;
}): { stage: ForwardStage; rationale: string } {
  const minEvents = params.minMonthlyEvents ?? 30;
  const maxDays = params.maxMedianDays ?? 75;

  const candidates = [...params.stageValues]
    .filter((v) => v.stage !== "new" && v.stage !== "booked")
    .sort((a, b) => STAGE_ORDER[b.stage] - STAGE_ORDER[a.stage]);

  for (const candidate of candidates) {
    const volume = params.monthlyVolumeByStage[candidate.stage] ?? 0;
    const days = candidate.medianDaysToBooking ?? 0;
    if (volume >= minEvents && days <= maxDays) {
      return {
        stage: candidate.stage,
        rationale:
          `${volume} events/month clears the ~${minEvents} needed for the learning phase, ` +
          `and a ${days}-day median keeps it inside Google's 90-day click window.`,
      };
    }
  }

  return {
    stage: "qualified",
    rationale:
      "No deeper stage yet has the monthly volume to sustain a learning phase. " +
      "Optimise on Qualified Lead for now and revisit once site visits exceed " +
      `~${minEvents}/month.`,
  };
}
