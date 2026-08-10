import { describe, expect, it } from "vitest";
import {
  DELIVERY_SAFETY_MARGIN_HOURS,
  GOOGLE_CLICK_WINDOW_DAYS,
  addDays,
  attributionClock,
  computeAttributionExpiry,
  computeDeliverBy,
  estimateAttributableShare,
  isTooOldForMeta,
} from "../attribution/windows";
import { decideResolution } from "../identity/resolve";
import { checkTransition, hasReached, maxStageReached } from "../pipeline/stages";
import { checkEligibility, scoreSpam, type EligibilityInput } from "./eligibility";
import { computeStageValues, recommendOptimizationEvent, shrinkRate } from "./value-model";

describe("attribution windows", () => {
  it("runs the Google clock from the click, not from lead receipt", () => {
    const clickedAt = new Date("2026-01-01T00:00:00Z");
    const occurredAt = new Date("2026-01-20T00:00:00Z"); // late import

    const expiry = computeAttributionExpiry({
      clickedAt,
      occurredAt,
      hasGoogleClickId: true,
    });

    // Anchored to the click — using receipt time would overstate the remaining
    // window by 19 days and cause silent drops at upload time.
    expect(expiry).toEqual(addDays(clickedAt, GOOGLE_CLICK_WINDOW_DAYS));
  });

  it("has no expiry when there is no Google click id", () => {
    expect(
      computeAttributionExpiry({
        clickedAt: new Date(),
        occurredAt: new Date(),
        hasGoogleClickId: false,
      }),
    ).toBeNull();
  });

  it("reports a countdown sales can act on", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    expect(attributionClock(addDays(now, 40), now).isExpiringSoon).toBe(false);
    expect(attributionClock(addDays(now, 10), now).isExpiringSoon).toBe(true);
    expect(attributionClock(addDays(now, -1), now).isExpired).toBe(true);
  });

  it("bounds Meta deliveries by the 7-day event_time limit", () => {
    const occurredAt = new Date("2026-03-01T00:00:00Z");
    const deliverBy = computeDeliverBy({ platform: "meta_capi", eventOccurredAt: occurredAt });

    const expected = new Date(
      addDays(occurredAt, 7).getTime() - DELIVERY_SAFETY_MARGIN_HOURS * 3600_000,
    );
    expect(deliverBy).toEqual(expected);
  });

  it("refuses to attempt a Meta send that would reject the whole batch", () => {
    const now = new Date("2026-03-10T00:00:00Z");
    expect(isTooOldForMeta(new Date("2026-03-08T00:00:00Z"), now)).toBe(false);
    expect(isTooOldForMeta(new Date("2026-03-01T00:00:00Z"), now)).toBe(true);
  });

  it("quantifies how many bookings the 90-day wall costs us", () => {
    // Real-estate cycle lengths: most bookings land outside Google's window.
    const daysToBooking = [45, 60, 88, 95, 120, 140, 210];
    const result = estimateAttributableShare(daysToBooking);
    expect(result.attributable).toBe(3);
    expect(result.total).toBe(7);
    expect(result.share).toBeCloseTo(3 / 7, 5);
  });
});

describe("pipeline stages", () => {
  it("treats stage as a high-water mark so skipping does not break the funnel", () => {
    // Walk-in checked straight in without ever being marked 'contacted'.
    const history = [{ toStage: "new" as const }, { toStage: "visited" as const }];

    expect(maxStageReached(history)).toBe("visited");
    expect(hasReached(history, "contacted")).toBe(true);
    expect(hasReached(history, "qualified")).toBe(true);
    expect(hasReached(history, "negotiating")).toBe(false);
  });

  it("ignores terminal stages when computing the high-water mark", () => {
    const history = [
      { toStage: "new" as const },
      { toStage: "qualified" as const },
      { toStage: "lost" as const },
    ];
    expect(maxStageReached(history)).toBe("qualified");
  });

  it("requires a reason for regressions and re-opens", () => {
    expect(checkTransition("new", "qualified")).toMatchObject({
      allowed: true,
      isRegression: false,
    });
    expect(checkTransition("qualified", "contacted")).toMatchObject({
      allowed: true,
      isRegression: true,
      requiresReason: true,
    });
    expect(checkTransition("lost", "contacted")).toMatchObject({
      allowed: true,
      requiresReason: true,
    });
  });

  it("blocks silently un-booking a lead", () => {
    // Money events must reverse through cancellation, which emits its own
    // event, rather than through an unlogged dropdown change.
    const result = checkTransition("booked", "negotiating");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Cancel the booking/);
  });
});

describe("identity resolution", () => {
  it("creates a new person when nothing matches", () => {
    expect(decideResolution([])).toMatchObject({ action: "create" });
  });

  it("is most confident when phone and email agree", () => {
    const result = decideResolution([
      { personId: "p1", identifierType: "phone" },
      { personId: "p1", identifierType: "email" },
    ]);
    expect(result).toMatchObject({ action: "attach", personId: "p1", confidence: 1.0 });
  });

  it("ranks phone above email", () => {
    expect(decideResolution([{ personId: "p1", identifierType: "phone" }])).toMatchObject({
      rule: "exact_phone",
      confidence: 0.95,
    });
    expect(decideResolution([{ personId: "p1", identifierType: "email" }])).toMatchObject({
      rule: "exact_email",
      confidence: 0.9,
    });
  });

  it("never auto-merges when identifiers point at different people", () => {
    // A shared household phone plus a personal email is the classic trap.
    // Silently merging two real buyers is far worse than a review task.
    const result = decideResolution([
      { personId: "p1", identifierType: "phone" },
      { personId: "p2", identifierType: "email" },
    ]);

    expect(result.action).toBe("attach_with_conflict");
    if (result.action !== "attach_with_conflict") throw new Error("unreachable");
    expect(result.personId).toBe("p1"); // phone wins
    expect(result.conflictingPersonIds).toEqual(["p2"]);
    expect(result.confidence).toBeLessThan(0.7);
  });
});

describe("conversion value model", () => {
  it("shrinks small samples toward the prior", () => {
    // 1 booking from 3 visits is not a 33% conversion rate.
    const naive = 1 / 3;
    const shrunk = shrinkRate(1, 3, 0.14, 40);
    expect(shrunk).toBeLessThan(naive);
    expect(shrunk).toBeCloseTo(0.14, 1);
  });

  it("moves toward the observed rate as evidence accumulates", () => {
    const small = shrinkRate(10, 100, 0.14, 40);
    const large = shrinkRate(100, 1000, 0.14, 40);
    // Both observe 10%; the larger sample should sit closer to it.
    expect(Math.abs(large - 0.1)).toBeLessThan(Math.abs(small - 0.1));
  });

  it("keeps the value ladder monotonic despite noisy samples", () => {
    // A freak run where visits out-converted negotiations must not teach the
    // ad platforms that deeper stages are worth less.
    const values = computeStageValues({
      observations: [
        { stage: "visited", reached: 10, converted: 9 },
        { stage: "negotiating", reached: 5, converted: 1 },
        { stage: "token_paid", reached: 3, converted: 3 },
      ],
      expectedSaleValue: 30_000_000,
    });

    const byStage = new Map(values.map((v) => [v.stage, v]));
    const visited = byStage.get("visited")!;
    const negotiating = byStage.get("negotiating")!;
    const tokenPaid = byStage.get("token_paid")!;

    expect(visited.probabilityToBooking).toBeLessThanOrEqual(negotiating.probabilityToBooking);
    expect(negotiating.probabilityToBooking).toBeLessThanOrEqual(tokenPaid.probabilityToBooking);
  });

  it("reports how much of each estimate is real evidence", () => {
    const values = computeStageValues({
      observations: [
        { stage: "qualified", reached: 0, converted: 0 },
        { stage: "visited", reached: 400, converted: 50 },
      ],
      expectedSaleValue: 30_000_000,
    });
    const byStage = new Map(values.map((v) => [v.stage, v]));
    expect(byStage.get("qualified")!.evidenceWeight).toBe(0);
    expect(byStage.get("visited")!.evidenceWeight).toBeGreaterThan(0.9);
  });

  it("will not recommend bidding on an event with too little volume", () => {
    const stageValues = computeStageValues({
      observations: [],
      expectedSaleValue: 30_000_000,
    });

    // Six bookings a month cannot sustain a learning phase.
    const sparse = recommendOptimizationEvent({
      stageValues,
      monthlyVolumeByStage: { qualified: 80, visited: 12, booked: 6 },
    });
    expect(sparse.stage).toBe("qualified");

    // With real site-visit volume, graduate deeper into the funnel.
    const healthy = recommendOptimizationEvent({
      stageValues: stageValues.map((v) =>
        v.stage === "visited" ? { ...v, medianDaysToBooking: 60 } : v,
      ),
      monthlyVolumeByStage: { qualified: 200, visited: 60 },
    });
    expect(healthy.stage).toBe("visited");
  });
});

describe("eligibility gate", () => {
  const base: EligibilityInput = {
    consent: { adUserData: "granted", adPersonalization: "granted" },
    identifiers: { hasClickId: true, hasHashedEmail: true, hasHashedPhone: true, hasFbp: false },
    lead: { isTest: false, spamScore: 0, lostReason: null },
    person: { isSuppressed: false },
    destination: { isEnabled: true, hasMapping: true },
    window: { isExpired: false },
  };

  it("passes a clean, consented lead", () => {
    const result = checkEligibility(base);
    expect(result.eligible).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("fails closed on unrecorded consent", () => {
    // Absence of a consent decision is not consent.
    const result = checkEligibility({
      ...base,
      consent: { adUserData: "unspecified", adPersonalization: "unspecified" },
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("consent_unknown");
  });

  it("blocks test leads, spam, and suppressed people", () => {
    expect(checkEligibility({ ...base, lead: { ...base.lead, isTest: true } }).reason).toBe(
      "test_lead",
    );
    expect(checkEligibility({ ...base, lead: { ...base.lead, spamScore: 90 } }).reason).toBe(
      "spam_score_exceeded",
    );
    expect(checkEligibility({ ...base, person: { isSuppressed: true } }).reason).toBe(
      "person_suppressed",
    );
    expect(
      checkEligibility({ ...base, lead: { ...base.lead, lostReason: "spam_or_bot" } }).reason,
    ).toBe("lead_disqualified_as_invalid");
  });

  it("requires at least one usable identifier", () => {
    const result = checkEligibility({
      ...base,
      identifiers: { hasClickId: false, hasHashedEmail: false, hasHashedPhone: false, hasFbp: false },
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("no_usable_identifier");
  });

  it("still sends on thin identifiers, but warns", () => {
    const result = checkEligibility({
      ...base,
      identifiers: { hasClickId: false, hasHashedEmail: false, hasHashedPhone: true, hasFbp: false },
    });
    expect(result.eligible).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("distinguishes an expired window from a failure", () => {
    expect(checkEligibility({ ...base, window: { isExpired: true } }).reason).toBe(
      "attribution_window_expired",
    );
  });
});

describe("spam scoring", () => {
  it("scores an obvious bot submission high", () => {
    const score = scoreSpam({
      name: "asdfasdf",
      phone: "1234567890",
      phoneValid: false,
      isDisposableEmail: true,
      timeOnPageSeconds: 1,
      userAgent: "python-requests/2.31",
      submissionsFromIpLastHour: 20,
    });
    expect(score).toBe(100);
  });

  it("leaves a genuine enquiry alone", () => {
    const score = scoreSpam({
      name: "Ravi Kumar",
      email: "ravi.kumar@gmail.com",
      phone: "+919876543210",
      phoneValid: true,
      timeOnPageSeconds: 95,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X)",
      submissionsFromIpLastHour: 1,
    });
    expect(score).toBeLessThan(20);
  });
});
