/**
 * Booking verification: the finance side of a sale, kept apart from the sales
 * side.
 *
 * `bookings.status` answers "how far has this sale progressed?". Verification
 * answers a different question — "has anyone in accounts actually seen this
 * money?" — and the two must be able to disagree, because in practice they do:
 * a booking is confirmed on the strength of a cheque image days before the
 * clearing shows up.
 */
export const VERIFICATION_STATUSES = ["pending", "validated", "no_match"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  pending: "Awaiting verification",
  validated: "Validated",
  no_match: "No match",
};

/** Fields every screen needs to render the verification state truthfully. */
export interface VerificationView {
  verificationStatus: VerificationStatus;
  /** Net collected when the decision was taken. */
  verifiedAmount: string | null;
  /** Net collected right now. */
  collectedAmount: string;
}

/**
 * Has money moved since the accountant signed off?
 *
 * Without this check a single tick against a ₹5L token would keep vouching for
 * every instalment that followed it — the badge would read "Validated" beside a
 * figure nobody in accounts has ever seen. A drifted booking is still validated
 * for the amount that was checked; it simply returns to the queue for the rest.
 */
export function verificationDrifted(view: VerificationView): boolean {
  if (view.verificationStatus !== "validated") return false;
  const verified = Number(view.verifiedAmount ?? 0);
  const collected = Number(view.collectedAmount ?? 0);
  if (!Number.isFinite(verified) || !Number.isFinite(collected)) return false;
  // Rounding noise between numeric(14,2) values is not a real difference.
  return Math.abs(collected - verified) >= 0.01;
}

/** The amount still waiting on a decision. Zero unless the booking drifted. */
export function unverifiedAmount(view: VerificationView): number {
  if (!verificationDrifted(view)) return 0;
  return Number(view.collectedAmount ?? 0) - Number(view.verifiedAmount ?? 0);
}

export function isVerificationStatus(value: unknown): value is VerificationStatus {
  return VERIFICATION_STATUSES.includes(value as VerificationStatus);
}
