import { describe, expect, it } from "vitest";
import { localDateTimeSchema, parseLocalDateTime } from "./datetime";

describe("datetime-local conversion", () => {
  it("interprets India-entered times in the organisation timezone", () => {
    expect(parseLocalDateTime("2026-08-10T15:42", "Asia/Kolkata")?.toISOString())
      .toBe("2026-08-10T10:12:00.000Z");
  });

  it("handles a daylight-saving timezone", () => {
    expect(parseLocalDateTime("2026-08-10T15:42", "America/New_York")?.toISOString())
      .toBe("2026-08-10T19:42:00.000Z");
  });

  it("rejects impossible calendar values", () => {
    expect(localDateTimeSchema.safeParse("2026-02-30T12:00").success).toBe(false);
    expect(parseLocalDateTime("2026-02-30T12:00", "Asia/Kolkata")).toBeNull();
  });
});
