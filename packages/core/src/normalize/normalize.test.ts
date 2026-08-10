import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizeEmail, normalizeNamePart, splitName } from "./email";
import {
  GOOGLE_HASH_OPTIONS,
  META_HASH_OPTIONS,
  hashEmail,
  hashPhone,
  hashIfNeeded,
  looksPreHashed,
} from "./hash";
import { maskPhone, normalizePhone } from "./phone";

const sha256 = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");

describe("normalizePhone", () => {
  it("normalizes the messy Indian inputs that actually arrive", () => {
    const cases: Array<[string, string]> = [
      ["9876543210", "+919876543210"],
      ["09876543210", "+919876543210"],
      ["+91 98765 43210", "+919876543210"],
      ["91-9876543210", "+919876543210"],
      ["0091 9876543210", "+919876543210"],
      ["+919876543210", "+919876543210"],
      ["  9876543210  ", "+919876543210"],
      ["(98765) 43210", "+919876543210"],
    ];
    for (const [input, expected] of cases) {
      expect(normalizePhone(input)?.e164, `input: ${input}`).toBe(expected);
    }
  });

  it("keeps NRI numbers intact rather than forcing them to +91", () => {
    const dubai = normalizePhone("+971 50 123 4567");
    expect(dubai?.e164).toBe("+971501234567");
    expect(dubai?.isInternational).toBe(true);

    const india = normalizePhone("9876543210");
    expect(india?.isInternational).toBe(false);
  });

  it("exposes both the E.164 and digits-only forms", () => {
    const result = normalizePhone("9876543210");
    expect(result?.e164).toBe("+919876543210");
    expect(result?.digits).toBe("919876543210");
  });

  it("rejects rather than guesses at unusable input", () => {
    for (const bad of ["", "   ", "12345", "abcdefghij", "0000000000"]) {
      expect(normalizePhone(bad), `input: ${bad}`).toBeNull();
    }
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it("rejects Indian numbers outside the mobile ranges", () => {
    // libphonenumber's isValid() for IN waves these through; India's numbering
    // plan reserves 6-9 for mobile, and bot-filled forms produce exactly this
    // shape. Cheapest reliable junk filter available.
    for (const bad of ["1234567890", "5555555555", "1111111111"]) {
      expect(normalizePhone(bad), `input: ${bad}`).toBeNull();
    }
    expect(normalizePhone("1234567890", { allowNonMobile: true })).not.toBeNull();
  });

  it("handles the STD-zero-plus-country-code form", () => {
    // "0919876543210" is typed constantly. Without an explicit case it parses
    // as something else and hashes differently from the same number entered
    // plainly — silently splitting one buyer into two records.
    expect(normalizePhone("091-9876543210")?.e164).toBe("+919876543210");
    expect(normalizePhone("0919876543210")?.e164).toBe("+919876543210");
  });

  it("masks numbers for logging", () => {
    expect(maskPhone("+919876543210")).toBe("+9198765•••10");
  });
});

describe("normalizeEmail", () => {
  it("collapses Gmail dots and +tags for deduplication", () => {
    expect(normalizeEmail("ravi.kumar+windwave@gmail.com")?.canonical).toBe("ravikumar@gmail.com");
    expect(normalizeEmail("RaviKumar@Gmail.com")?.canonical).toBe("ravikumar@gmail.com");
  });

  it("does NOT strip dots for non-Gmail domains", () => {
    // Doing so would merge two genuinely different people on most providers.
    expect(normalizeEmail("ravi.kumar@monark.in")?.canonical).toBe("ravi.kumar@monark.in");
  });

  it("keeps the hashing form conservative — lowercase and trim only", () => {
    // This is the crux: our aggressive canonicalisation must never reach the
    // hash, or the digest will not match what the ad platform computed.
    const result = normalizeEmail("  Ravi.Kumar+ads@Gmail.com  ");
    expect(result?.canonical).toBe("ravikumar@gmail.com");
    expect(result?.forHashing).toBe("ravi.kumar+ads@gmail.com");
  });

  it("flags disposable and role addresses without rejecting them", () => {
    expect(normalizeEmail("x@mailinator.com")?.isDisposable).toBe(true);
    expect(normalizeEmail("info@monark.in")?.isRoleAccount).toBe(true);
    expect(normalizeEmail("ravi@monark.in")?.isRoleAccount).toBe(false);
  });

  it("rejects malformed addresses", () => {
    for (const bad of ["", "notanemail", "a@b", "@example.com", "a@@b.com", "a b@c.com"]) {
      expect(normalizeEmail(bad), `input: ${bad}`).toBeNull();
    }
  });
});

describe("name normalization", () => {
  it("strips diacritics and punctuation for hashing", () => {
    expect(normalizeNamePart("  Ravi  Kumar. ")).toBe("ravi kumar");
    expect(normalizeNamePart("José")).toBe("jose");
    expect(normalizeNamePart("O'Brien")).toBe("obrien");
  });

  it("splits names on a best-effort basis", () => {
    expect(splitName("Ravi Kumar")).toEqual({ firstName: "Ravi", lastName: "Kumar" });
    expect(splitName("Ravi")).toEqual({ firstName: "Ravi", lastName: null });
    expect(splitName("Ravi Kumar Reddy")).toEqual({ firstName: "Ravi", lastName: "Reddy" });
    expect(splitName(null)).toEqual({ firstName: null, lastName: null });
  });
});

describe("PII hashing", () => {
  it("hashes the trimmed lowercase email, not our canonical form", () => {
    expect(hashEmail("  Ravi.Kumar+ads@Gmail.com  ")).toBe(sha256("ravi.kumar+ads@gmail.com"));
  });

  it("uses DIFFERENT phone formats for Meta and Google", () => {
    // The single most likely cause of an unexplained low match rate.
    // Meta wants digits only; Google wants E.164 with the leading '+'.
    const metaHash = hashPhone("9876543210", META_HASH_OPTIONS);
    const googleHash = hashPhone("9876543210", GOOGLE_HASH_OPTIONS);

    expect(metaHash).toBe(sha256("919876543210"));
    expect(googleHash).toBe(sha256("+919876543210"));
    expect(metaHash).not.toBe(googleHash);
  });

  it("produces identical digests regardless of input formatting", () => {
    const variants = ["9876543210", "+91 98765 43210", "091-9876543210", "0091 9876543210"];
    const hashes = new Set(variants.map((v) => hashPhone(v, META_HASH_OPTIONS)));
    expect(hashes.size).toBe(1);
  });

  it("detects pre-hashed values so we never double-hash", () => {
    const alreadyHashed = sha256("ravi@example.com");
    expect(looksPreHashed(alreadyHashed)).toBe(true);
    expect(looksPreHashed("ravi@example.com")).toBe(false);

    // Double-hashing is silent and matches nothing — the check must hold.
    expect(hashIfNeeded(alreadyHashed, (v) => hashEmail(v))).toBe(alreadyHashed);
    expect(hashIfNeeded("ravi@example.com", (v) => hashEmail(v))).toBe(alreadyHashed);
  });

  it("returns null for unusable input rather than hashing empty strings", () => {
    expect(hashEmail(null)).toBeNull();
    expect(hashEmail("not-an-email")).toBeNull();
    expect(hashPhone("12345")).toBeNull();
  });
});
