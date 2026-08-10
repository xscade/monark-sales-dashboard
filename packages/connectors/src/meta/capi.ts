import type { ConversionEventType } from "@monark/core";
import { isTooOldForMeta } from "@monark/core";
import type {
  ConversionAdapter,
  DeliveryResult,
  OutboundConversion,
} from "../types";

export interface MetaCapiConfig {
  datasetId: string;
  accessToken: string;
  apiVersion?: string;
  /** Routes events to the Events Manager test console. They are visible for
   *  debugging but NOT used for optimisation — never set in production. */
  testEventCode?: string | null;
  dryRun: boolean;
  /** Internal event → Meta event name. Configured per destination. */
  eventNameMap: Partial<Record<ConversionEventType, string>>;
  timeoutMs?: number;
}

/**
 * Where the conversion physically happened.
 *
 * Meta uses `action_source` to reason about the event, so it is worth getting
 * right rather than sending `website` for everything. A site visit really did
 * happen in a physical place, and telling Meta so is part of what makes offline
 * conversion data more useful than a web event replayed from a CRM.
 */
const ACTION_SOURCE: Record<ConversionEventType, string> = {
  lead_created: "website",
  lead_contacted: "phone_call",
  lead_qualified: "phone_call",
  visit_scheduled: "phone_call",
  walk_in_completed: "physical_store",
  site_visit_completed: "physical_store",
  unit_shortlisted: "physical_store",
  negotiation_started: "physical_store",
  token_paid: "physical_store",
  booking_confirmed: "physical_store",
  sale_completed: "physical_store",
  booking_cancelled: "system_generated",
  lead_disqualified: "system_generated",
};

/**
 * Meta error codes that are worth retrying.
 *   1, 2       transient API / unknown
 *   4, 17, 32  application & user rate limits
 *   613        calls-per-second limit
 *   368        temporarily blocked
 * Everything else — notably 190 (bad token) and 100 (bad parameter) — needs a
 * human, and retrying just burns the attempt budget while the problem persists.
 */
const RETRYABLE_META_CODES = new Set([1, 2, 4, 17, 32, 341, 368, 613]);

export class MetaCapiAdapter implements ConversionAdapter {
  readonly platform = "meta_capi";

  constructor(private readonly config: MetaCapiConfig) {}

  async send(events: OutboundConversion[]): Promise<DeliveryResult> {
    const started = Date.now();

    // Meta rejects the ENTIRE request if any event_time is older than 7 days —
    // one stale event poisons a batch of otherwise-deliverable ones. Filter
    // before sending rather than discovering it in the response.
    const now = new Date();
    const tooOld = events.filter((e) => isTooOldForMeta(e.occurredAt, now));
    const sendable = events.filter((e) => !isTooOldForMeta(e.occurredAt, now));

    if (sendable.length === 0) {
      return {
        ok: false,
        failureKind: "permanent",
        error:
          `All ${events.length} event(s) exceed Meta's 7-day event_time limit. ` +
          `This is unrecoverable data loss and indicates the outbox was stalled.`,
        requestPayload: { skipped: tooOld.map((e) => e.eventKey) },
        durationMs: Date.now() - started,
        dryRun: this.config.dryRun,
      };
    }

    const payload: Record<string, unknown> = {
      data: sendable.map((e) => this.buildEvent(e)),
    };
    if (this.config.testEventCode) {
      payload.test_event_code = this.config.testEventCode;
    }

    if (this.config.dryRun) {
      return {
        ok: true,
        requestPayload: payload,
        responseBody: { dry_run: true, would_send: sendable.length, skipped_too_old: tooOld.length },
        durationMs: Date.now() - started,
        dryRun: true,
      };
    }

    const version = this.config.apiVersion ?? "v21.0";
    const url = `https://graph.facebook.com/${version}/${this.config.datasetId}/events`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.accessToken}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 20_000),
      });

      const body = (await response.json().catch(() => ({}))) as Record<string, any>;
      const durationMs = Date.now() - started;

      if (response.ok) {
        return {
          ok: true,
          httpStatus: response.status,
          traceId: body.fbtrace_id ?? null,
          // Meta does not return match quality on every response; when it is
          // absent we record null rather than inventing a number.
          matchQuality: typeof body.events_received === "number" ? null : null,
          requestPayload: payload,
          responseBody: body,
          durationMs,
          dryRun: false,
        };
      }

      const code = body?.error?.code as number | undefined;
      const retryable =
        response.status >= 500 ||
        response.status === 429 ||
        (code !== undefined && RETRYABLE_META_CODES.has(code));

      return {
        ok: false,
        failureKind: retryable ? "retryable" : "permanent",
        httpStatus: response.status,
        traceId: body?.error?.fbtrace_id ?? null,
        error:
          body?.error?.error_user_msg ??
          body?.error?.message ??
          `Meta returned HTTP ${response.status}`,
        requestPayload: payload,
        responseBody: body,
        durationMs,
        dryRun: false,
      };
    } catch (err) {
      // Network failure or timeout — always worth retrying.
      return {
        ok: false,
        failureKind: "retryable",
        error: err instanceof Error ? err.message : String(err),
        requestPayload: payload,
        durationMs: Date.now() - started,
        dryRun: false,
      };
    }
  }

  private buildEvent(e: OutboundConversion): Record<string, unknown> {
    const eventName = this.config.eventNameMap[e.eventType];
    if (!eventName) {
      throw new Error(`No Meta event name mapped for ${e.eventType}`);
    }

    const userData: Record<string, unknown> = {};

    // Meta expects hashed fields as single-element arrays.
    const put = (key: string, value: string | null | undefined) => {
      if (value) userData[key] = [value];
    };
    put("em", e.user.emailSha256);
    put("ph", e.user.phoneSha256);
    put("fn", e.user.firstNameSha256);
    put("ln", e.user.lastNameSha256);
    put("ct", e.user.citySha256);
    put("st", e.user.stateSha256);
    put("zp", e.user.postalCodeSha256);
    put("country", e.user.countrySha256);

    // These are NOT hashed — Meta matches them verbatim.
    if (e.user.fbp) userData.fbp = e.user.fbp;
    if (e.user.externalId) userData.external_id = e.user.externalId;
    if (e.user.metaLeadId) userData.lead_id = e.user.metaLeadId;

    // `fbc` is the click cookie. If the browser did not set one but we captured
    // the fbclid, Meta accepts a reconstructed value in the documented
    // `fb.1.<timestamp_ms>.<fbclid>` form, which is materially better than
    // sending no click identifier at all.
    if (e.user.fbc) {
      userData.fbc = e.user.fbc;
    } else if (e.clickIds.fbclid) {
      userData.fbc = `fb.1.${e.occurredAt.getTime()}.${e.clickIds.fbclid}`;
    }

    if (e.context.clientIpAddress) userData.client_ip_address = e.context.clientIpAddress;
    if (e.context.clientUserAgent) userData.client_user_agent = e.context.clientUserAgent;

    // Click-to-WhatsApp ads carry their own click id. Passing it through is
    // what connects a WhatsApp conversation back to the ad that started it —
    // a channel that is otherwise entirely invisible to the CRM.
    if (e.clickIds.ctwaClid) userData.ctwa_clid = e.clickIds.ctwaClid;

    const customData: Record<string, unknown> = {};
    if (e.value !== null) {
      customData.value = e.value;
      customData.currency = e.currency;
    }
    if (e.context.projectName) customData.content_name = e.context.projectName;
    if (e.context.leadReference) {
      // Meta's default offline dedup key.
      customData.order_id = e.context.leadReference;
    }

    const event: Record<string, unknown> = {
      event_name: eventName,
      event_time: Math.floor(e.occurredAt.getTime() / 1000),
      /**
       * Shared with the browser Pixel's event_id for `lead_created`.
       *
       * Without this the Pixel fires Lead client-side AND we fire Lead
       * server-side, and Meta counts one enquiry twice — inflating reported
       * performance and corrupting the bidding signal.
       */
      event_id: e.eventKey,
      action_source: ACTION_SOURCE[e.eventType],
      user_data: userData,
    };

    if (Object.keys(customData).length > 0) event.custom_data = customData;
    if (e.context.sourceUrl && ACTION_SOURCE[e.eventType] === "website") {
      event.event_source_url = e.context.sourceUrl;
    }

    // Meta requires opt_out to reflect the user's choice where known.
    if (e.consent.adPersonalization === "denied") event.opt_out = true;

    return event;
  }
}
