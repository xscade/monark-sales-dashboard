import { describe, expect, it } from "vitest";
import { buildCallTarget, CONTACT_CHANNELS } from "./call";

describe("buildCallTarget", () => {
  it("returns nothing without a number", () => {
    expect(buildCallTarget(null)).toBeNull();
    expect(buildCallTarget("   ")).toBeNull();
  });

  it("keeps the country code on a stored E.164 number", () => {
    const target = buildCallTarget("+919381167516");
    expect(target?.e164).toBe("+919381167516");
    expect(target?.tel).toBe("tel:+919381167516");
    expect(target?.countryCode).toBe("+91");
  });

  it("adds the country code to a bare ten-digit number", () => {
    // A scanner has no default region, so the QR must carry the +91 itself.
    expect(buildCallTarget("9381167516")?.tel).toBe("tel:+919381167516");
  });

  it("groups the display number after the country code", () => {
    expect(buildCallTarget("+919381167516")?.display).toBe("+91 93811 67516");
  });

  it("allows a landline that lead capture would have rejected", () => {
    expect(buildCallTarget("+914023456789")?.e164).toBe("+914023456789");
  });

  it("still dials an unparseable stored number", () => {
    const target = buildCallTarget("+1 555 0100 9999 8");
    expect(target?.tel).toBe("tel:+1555010099998");
    expect(target?.display).toBe("+1555010099998");
  });

  it("produces a square QR matrix per channel that encodes something", () => {
    const target = buildCallTarget("+919381167516");
    for (const channel of CONTACT_CHANNELS) {
      expect(target?.channels[channel].qrSize).toBeGreaterThanOrEqual(21);
      expect(target?.channels[channel].qrPath.length).toBeGreaterThan(0);
    }
  });

  it("encodes an explicit scheme per channel, never a bare number", () => {
    // A QR carrying only digits is interpreted differently by every scanner —
    // which is how scanning a "call" code ended up opening Messages.
    const target = buildCallTarget("+919381167516");
    expect(target?.channels.call.uri).toBe("tel:+919381167516");
    expect(target?.channels.sms.uri).toBe("sms:+919381167516");
    // wa.me 404s on a leading "+", so the digits go in bare.
    expect(target?.channels.whatsapp.uri).toBe("https://wa.me/919381167516");
  });

  it("gives each channel a distinct code", () => {
    const target = buildCallTarget("+919381167516");
    const paths = CONTACT_CHANNELS.map((channel) => target?.channels[channel].qrPath);
    expect(new Set(paths).size).toBe(CONTACT_CHANNELS.length);
  });
});
