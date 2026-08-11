import { describe, expect, it } from "vitest";
import {
  isVerificationStatus,
  unverifiedAmount,
  verificationDrifted,
  type VerificationView,
} from "./verification";

function view(overrides: Partial<VerificationView>): VerificationView {
  return {
    verificationStatus: "validated",
    verifiedAmount: "500000.00",
    collectedAmount: "500000.00",
    ...overrides,
  };
}

describe("verification drift", () => {
  it("holds a validated booking whose collections have not moved", () => {
    expect(verificationDrifted(view({}))).toBe(false);
    expect(unverifiedAmount(view({}))).toBe(0);
  });

  it("re-raises a validated booking once more money arrives", () => {
    const drifted = view({ collectedAmount: "2500000.00" });
    expect(verificationDrifted(drifted)).toBe(true);
    expect(unverifiedAmount(drifted)).toBe(2_000_000);
  });

  it("re-raises it after a refund too", () => {
    // The signed-off figure is no longer what is in the account, whichever way
    // it moved — a refund is exactly the case a stale tick would hide.
    expect(verificationDrifted(view({ collectedAmount: "100000.00" }))).toBe(true);
  });

  it("ignores sub-paisa noise between two numeric(14,2) values", () => {
    expect(verificationDrifted(view({ collectedAmount: "500000.004" }))).toBe(false);
  });

  it("never calls an undecided or flagged booking drifted", () => {
    for (const status of ["pending", "no_match"] as const) {
      expect(
        verificationDrifted(view({ verificationStatus: status, collectedAmount: "900000.00" })),
      ).toBe(false);
    }
  });

  it("treats a validated row with no snapshot as fully unverified", () => {
    // Only reachable for data written before the snapshot column existed; it
    // must surface in the queue rather than silently vouch for the balance.
    const legacy = view({ verifiedAmount: null, collectedAmount: "500000.00" });
    expect(verificationDrifted(legacy)).toBe(true);
    expect(unverifiedAmount(legacy)).toBe(500_000);
  });

  it("recognises only the three real statuses", () => {
    expect(isVerificationStatus("validated")).toBe(true);
    expect(isVerificationStatus("rejected")).toBe(false);
    expect(isVerificationStatus(undefined)).toBe(false);
  });
});
