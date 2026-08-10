import { describe, expect, it } from "vitest";
import { ordinal, siteVisitLabel } from "./site-visits";

describe("ordinal", () => {
  it("uses the right suffix for the common cases", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(4)).toBe("4th");
  });

  it("handles the teens, which do not follow the last digit", () => {
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
  });

  it("resumes the pattern past the teens", () => {
    expect(ordinal(21)).toBe("21st");
    expect(ordinal(22)).toBe("22nd");
    expect(ordinal(103)).toBe("103rd");
    expect(ordinal(111)).toBe("111th");
  });
});

describe("siteVisitLabel", () => {
  it("leaves the first visit unnumbered", () => {
    // "Book a 1st site visit" is not how anyone speaks.
    expect(siteVisitLabel(0)).toBe("They want to book a site visit");
  });

  it("numbers the next visit, not the last one", () => {
    expect(siteVisitLabel(1)).toBe("They want to book a 2nd site visit");
    expect(siteVisitLabel(3)).toBe("They want to book a 4th site visit");
    expect(siteVisitLabel(10)).toBe("They want to book a 11th site visit");
  });

  it("survives a missing or nonsensical count rather than rendering NaN", () => {
    expect(siteVisitLabel(Number.NaN)).toBe("They want to book a site visit");
    expect(siteVisitLabel(-2)).toBe("They want to book a site visit");
    expect(siteVisitLabel(2.7)).toBe("They want to book a 3rd site visit");
  });
});
