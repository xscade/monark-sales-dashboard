import { describe, expect, it } from "vitest";
import { GoogleDataManagerAdapter } from "./google/data-manager";
import { MetaCapiAdapter } from "./meta/capi";
import type { OutboundConversion } from "./types";

function conversion(overrides: Partial<OutboundConversion> = {}): OutboundConversion {
  return {
    eventType: "site_visit_completed",
    eventKey: "evt_abc123",
    occurredAt: new Date(),
    value: 4_200_000,
    currency: "INR",
    user: {
      emailSha256: "a".repeat(64),
      phoneSha256: "b".repeat(64),
      firstNameSha256: "c".repeat(64),
      lastNameSha256: "d".repeat(64),
      fbp: "fb.1.1700000000.1234567890",
    },
    clickIds: { gclid: "Cj0KCQtest" },
    consent: { adUserData: "granted", adPersonalization: "granted" },
    context: {
      leadReference: "LD-2026-008321",
      projectName: "Monark Windwave",
      clientIpAddress: "203.0.113.0",
      clientUserAgent: "Mozilla/5.0",
    },
    ...overrides,
  };
}

describe("MetaCapiAdapter", () => {
  const adapter = new MetaCapiAdapter({
    datasetId: "123456",
    accessToken: "token",
    dryRun: true,
    eventNameMap: {
      site_visit_completed: "MonarkSiteVisit",
      lead_created: "Lead",
      booking_confirmed: "Purchase",
    },
  });

  it("builds an offline event with physical_store as the action source", async () => {
    const result = await adapter.send([conversion()]);
    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);

    const event = (result.requestPayload as any).data[0];
    expect(event.event_name).toBe("MonarkSiteVisit");
    // A site visit genuinely happened in a physical place — telling Meta so is
    // part of what makes offline data more useful than a replayed web event.
    expect(event.action_source).toBe("physical_store");
    expect(event.event_id).toBe("evt_abc123");
    expect(event.custom_data.value).toBe(4_200_000);
    expect(event.custom_data.currency).toBe("INR");
  });

  it("wraps hashed identifiers in arrays and leaves fbp/lead_id raw", async () => {
    const result = await adapter.send([conversion()]);
    const userData = (result.requestPayload as any).data[0].user_data;

    expect(userData.em).toEqual(["a".repeat(64)]);
    expect(userData.ph).toEqual(["b".repeat(64)]);
    // Not hashed — Meta matches these verbatim.
    expect(userData.fbp).toBe("fb.1.1700000000.1234567890");
  });

  it("reconstructs fbc from fbclid when the cookie is missing", async () => {
    // Must be inside Meta's 7-day window or the adapter correctly refuses it.
    const occurredAt = new Date(Date.now() - 60 * 60 * 1000);
    const result = await adapter.send([
      conversion({
        occurredAt,
        user: { emailSha256: "a".repeat(64) },
        clickIds: { fbclid: "IwAR123" },
      }),
    ]);

    const userData = (result.requestPayload as any).data[0].user_data;
    expect(userData.fbc).toBe(`fb.1.${occurredAt.getTime()}.IwAR123`);
  });

  it("passes the click-to-WhatsApp click id through", async () => {
    // CTWA leads are otherwise completely invisible to the CRM's attribution.
    const result = await adapter.send([
      conversion({ clickIds: { ctwaClid: "ctwa_xyz" } }),
    ]);
    expect((result.requestPayload as any).data[0].user_data.ctwa_clid).toBe("ctwa_xyz");
  });

  it("uses website as the action source for web-originated leads", async () => {
    const result = await adapter.send([
      conversion({ eventType: "lead_created", context: { sourceUrl: "https://monark.in/4bhk" } }),
    ]);
    const event = (result.requestPayload as any).data[0];
    expect(event.action_source).toBe("website");
    expect(event.event_source_url).toBe("https://monark.in/4bhk");
  });

  it("refuses to send events past Meta's 7-day event_time limit", async () => {
    // Meta rejects the ENTIRE request if any event is too old, so a stale event
    // must never be allowed to poison a batch of deliverable ones.
    const stale = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
    const result = await adapter.send([conversion({ occurredAt: stale })]);

    expect(result.ok).toBe(false);
    expect(result.failureKind).toBe("permanent");
    expect(result.error).toMatch(/7-day/);
  });

  it("drops only the stale events when the batch is mixed", async () => {
    const stale = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
    const result = await adapter.send([
      conversion({ eventKey: "old", occurredAt: stale }),
      conversion({ eventKey: "fresh" }),
    ]);

    expect(result.ok).toBe(true);
    const data = (result.requestPayload as any).data;
    expect(data).toHaveLength(1);
    expect(data[0].event_id).toBe("fresh");
  });

  it("sets opt_out when ad personalization was denied", async () => {
    const result = await adapter.send([
      conversion({ consent: { adUserData: "granted", adPersonalization: "denied" } }),
    ]);
    expect((result.requestPayload as any).data[0].opt_out).toBe(true);
  });
});

describe("GoogleDataManagerAdapter", () => {
  const adapter = new GoogleDataManagerAdapter({
    operatingAccountId: "1234567890",
    loginAccountId: "9876543210",
    productDestinationId: "conv_action_1",
    getAccessToken: async () => "fake-token",
    dryRun: true,
    eventNameMap: { site_visit_completed: "Site Visit" },
  });

  it("targets the Data Manager ingest shape, not the legacy Ads API", async () => {
    const result = await adapter.send([conversion()]);
    const payload = result.requestPayload as any;

    expect(payload.destinations[0].operatingAccount).toEqual({
      accountType: "GOOGLE_ADS",
      accountId: "1234567890",
    });
    expect(payload.destinations[0].loginAccount.accountId).toBe("9876543210");
    expect(payload.destinations[0].productDestinationId).toBe("conv_action_1");
    expect(payload.encoding).toBe("HEX");
  });

  it("sets validateOnly in dry-run so nothing is recorded", async () => {
    const result = await adapter.send([conversion()]);
    expect((result.requestPayload as any).validateOnly).toBe(true);
  });

  it("sends hashed identifiers and the click id", async () => {
    const result = await adapter.send([conversion()]);
    const event = (result.requestPayload as any).events[0];

    expect(event.userData.userIdentifiers).toContainEqual({ emailAddress: "a".repeat(64) });
    expect(event.userData.userIdentifiers).toContainEqual({ phoneNumber: "b".repeat(64) });
    expect(event.adIdentifiers.gclid).toBe("Cj0KCQtest");
    expect(event.transactionId).toBe("evt_abc123");
    expect(event.conversionValue).toBe(4_200_000);
    expect(event.currency).toBe("INR");
  });

  it("carries gbraid and wbraid, not just gclid", async () => {
    // These cover the iOS and app-to-web flows. Omitting them silently loses a
    // growing share of Google attribution.
    const result = await adapter.send([
      conversion({ clickIds: { gbraid: "gb_123", wbraid: "wb_456" } }),
    ]);
    const ids = (result.requestPayload as any).events[0].adIdentifiers;
    expect(ids.gbraid).toBe("gb_123");
    expect(ids.wbraid).toBe("wb_456");
    expect(ids.gclid).toBeUndefined();
  });

  it("maps consent onto Google's enum", async () => {
    const result = await adapter.send([
      conversion({ consent: { adUserData: "granted", adPersonalization: "denied" } }),
    ]);
    expect((result.requestPayload as any).events[0].consent).toEqual({
      adUserData: "CONSENT_GRANTED",
      adPersonalization: "CONSENT_DENIED",
    });
  });

  it("omits the address identifier when no name parts are present", async () => {
    const result = await adapter.send([
      conversion({ user: { emailSha256: "a".repeat(64) } }),
    ]);
    const identifiers = (result.requestPayload as any).events[0].userData.userIdentifiers;
    expect(identifiers.some((i: any) => "address" in i)).toBe(false);
  });

  it("rejects a batch over Google's 2000-event limit without calling out", async () => {
    const oversized = Array.from({ length: 2001 }, (_, i) =>
      conversion({ eventKey: `evt_${i}` }),
    );
    const result = await adapter.send(oversized);
    expect(result.ok).toBe(false);
    expect(result.failureKind).toBe("permanent");
  });

  it("treats a credential failure as permanent rather than retrying forever", async () => {
    const broken = new GoogleDataManagerAdapter({
      operatingAccountId: "1",
      productDestinationId: "c",
      getAccessToken: async () => {
        throw new Error("invalid_grant");
      },
      dryRun: false,
      eventNameMap: {},
    });

    const result = await broken.send([conversion()]);
    expect(result.ok).toBe(false);
    expect(result.failureKind).toBe("permanent");
    expect(result.error).toMatch(/invalid_grant/);
  });
});
