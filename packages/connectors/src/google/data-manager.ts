import type { ConversionEventType } from "@monark/core";
import type {
  ConversionAdapter,
  DeliveryResult,
  OutboundConversion,
} from "../types";

/**
 * Google Data Manager API adapter.
 *
 * Deliberately NOT built on the Google Ads API's `UploadClickConversions`.
 * As of 15 June 2026 Google migrated offline conversion imports and enhanced
 * conversions for leads out of the Ads API and into the Data Manager API, and
 * blocked new adopters on the old path. Building against the legacy endpoint
 * today would be writing a migration for yourself on day one.
 *
 * Endpoint: POST https://datamanager.googleapis.com/v1/events:ingest
 * Scope:    https://www.googleapis.com/auth/datamanager
 */

export interface GoogleDataManagerConfig {
  /** Google Ads customer ID, digits only, no hyphens. */
  operatingAccountId: string;
  /** Manager (MCC) account ID, when access is delegated through one. */
  loginAccountId?: string | null;
  /** Conversion action to attribute to. */
  productDestinationId: string;
  accountType?: "GOOGLE_ADS" | "GOOGLE_ANALYTICS_PROPERTY" | "FLOODLIGHT_CONFIG";
  /** Returns an OAuth access token. Injected so credential handling and token
   *  caching stay outside this adapter. */
  getAccessToken: () => Promise<string>;
  dryRun: boolean;
  eventNameMap: Partial<Record<ConversionEventType, string>>;
  /** Route different internal events to different conversion actions. */
  destinationIdMap?: Partial<Record<ConversionEventType, string>>;
  timeoutMs?: number;
}

/** Google caps a single ingest call at 2,000 events. */
export const GOOGLE_MAX_EVENTS_PER_REQUEST = 2000;

const EVENT_SOURCE: Record<ConversionEventType, "WEB" | "APP" | "IN_STORE"> = {
  lead_created: "WEB",
  lead_contacted: "IN_STORE",
  lead_qualified: "IN_STORE",
  visit_scheduled: "IN_STORE",
  walk_in_completed: "IN_STORE",
  site_visit_completed: "IN_STORE",
  unit_shortlisted: "IN_STORE",
  negotiation_started: "IN_STORE",
  token_paid: "IN_STORE",
  booking_confirmed: "IN_STORE",
  sale_completed: "IN_STORE",
  booking_cancelled: "IN_STORE",
  lead_disqualified: "IN_STORE",
};

function toConsentState(v: "granted" | "denied" | "unspecified"): string {
  if (v === "granted") return "CONSENT_GRANTED";
  if (v === "denied") return "CONSENT_DENIED";
  return "CONSENT_UNSPECIFIED";
}

export class GoogleDataManagerAdapter implements ConversionAdapter {
  readonly platform = "google_data_manager";

  constructor(private readonly config: GoogleDataManagerConfig) {}

  async send(events: OutboundConversion[]): Promise<DeliveryResult> {
    const started = Date.now();

    if (events.length > GOOGLE_MAX_EVENTS_PER_REQUEST) {
      return {
        ok: false,
        failureKind: "permanent",
        error: `Batch of ${events.length} exceeds Google's ${GOOGLE_MAX_EVENTS_PER_REQUEST}-event limit`,
        requestPayload: null,
        durationMs: Date.now() - started,
        dryRun: this.config.dryRun,
      };
    }

    const payload = this.buildPayload(events);

    // Google supports server-side validation natively, so dry-run here is a
    // real round trip that exercises auth and payload validation without
    // recording anything. Strictly better than a local mock.
    if (this.config.dryRun) {
      payload.validateOnly = true;
    }

    let accessToken: string;
    try {
      accessToken = await this.config.getAccessToken();
    } catch (err) {
      return {
        ok: false,
        // Credential problems need a human, not another attempt.
        failureKind: "permanent",
        error: `Failed to obtain Google access token: ${
          err instanceof Error ? err.message : String(err)
        }`,
        requestPayload: payload,
        durationMs: Date.now() - started,
        dryRun: this.config.dryRun,
      };
    }

    try {
      const response = await fetch("https://datamanager.googleapis.com/v1/events:ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 30_000),
      });

      const body = (await response.json().catch(() => ({}))) as Record<string, any>;
      const durationMs = Date.now() - started;

      if (response.ok) {
        return {
          ok: true,
          httpStatus: response.status,
          traceId: body.requestId ?? null,
          requestPayload: payload,
          responseBody: body,
          durationMs,
          dryRun: this.config.dryRun,
        };
      }

      return {
        ok: false,
        failureKind: classifyGoogleFailure(response.status, body),
        httpStatus: response.status,
        traceId: body?.error?.details?.[0]?.requestId ?? null,
        error: body?.error?.message ?? `Google returned HTTP ${response.status}`,
        requestPayload: payload,
        responseBody: body,
        durationMs,
        dryRun: this.config.dryRun,
      };
    } catch (err) {
      return {
        ok: false,
        failureKind: "retryable",
        error: err instanceof Error ? err.message : String(err),
        requestPayload: payload,
        durationMs: Date.now() - started,
        dryRun: this.config.dryRun,
      };
    }
  }

  private buildPayload(events: OutboundConversion[]): Record<string, any> {
    const destination: Record<string, unknown> = {
      operatingAccount: {
        accountType: this.config.accountType ?? "GOOGLE_ADS",
        accountId: this.config.operatingAccountId,
      },
      productDestinationId: this.config.productDestinationId,
    };

    if (this.config.loginAccountId) {
      destination.loginAccount = {
        accountType: "GOOGLE_ADS",
        accountId: this.config.loginAccountId,
      };
    }

    return {
      destinations: [destination],
      // All our digests are lowercase hex; declaring it explicitly avoids any
      // ambiguity about how Google should decode them.
      encoding: "HEX",
      events: events.map((e) => this.buildEvent(e)),
    };
  }

  private buildEvent(e: OutboundConversion): Record<string, unknown> {
    const userIdentifiers: Record<string, unknown>[] = [];

    /**
     * NOTE ON PHONE HASHING — the most likely cause of a low match rate.
     *
     * These digests are computed upstream using GOOGLE_HASH_OPTIONS, which
     * hashes E.164 *with* the leading '+'. Google's Data Manager reference has
     * at times described phone normalisation as "remove non-digit characters",
     * which contradicts the E.164 rule documented for enhanced conversions and
     * Customer Match. We follow E.164 as the better-corroborated rule.
     *
     * If Google match rate looks unexpectedly poor, this is the first knob to
     * turn: flip `phoneFormat` on the destination and compare over a week.
     * Do not change it and the payload shape at the same time.
     */
    if (e.user.emailSha256) userIdentifiers.push({ emailAddress: e.user.emailSha256 });
    if (e.user.phoneSha256) userIdentifiers.push({ phoneNumber: e.user.phoneSha256 });

    // Address identifiers only help when the name parts are present; a bare
    // region code matches nothing and just inflates the payload.
    if (e.user.firstNameSha256 || e.user.lastNameSha256) {
      const address: Record<string, unknown> = { regionCode: "IN" };
      if (e.user.firstNameSha256) address.givenName = e.user.firstNameSha256;
      if (e.user.lastNameSha256) address.familyName = e.user.lastNameSha256;
      if (e.user.postalCodeSha256) address.postalCode = e.user.postalCodeSha256;
      userIdentifiers.push({ address });
    }

    const event: Record<string, unknown> = {
      // Shared with Meta's event_id. Google uses it to deduplicate the same
      // conversion arriving from more than one source.
      transactionId: e.eventKey,
      eventTimestamp: e.occurredAt.toISOString(),
      eventSource: EVENT_SOURCE[e.eventType],
      consent: {
        adUserData: toConsentState(e.consent.adUserData),
        adPersonalization: toConsentState(e.consent.adPersonalization),
      },
    };

    if (userIdentifiers.length > 0) {
      event.userData = { userIdentifiers };
    }

    // Click identifiers. Only one will ever be present: gclid for standard web
    // clicks, gbraid/wbraid for the app-to-web and iOS privacy-preserving
    // flows. Omitting the latter two silently loses a growing share of Google
    // attribution, which is why they are first-class here rather than optional.
    const adIdentifiers: Record<string, unknown> = {};
    if (e.clickIds.gclid) adIdentifiers.gclid = e.clickIds.gclid;
    if (e.clickIds.gbraid) adIdentifiers.gbraid = e.clickIds.gbraid;
    if (e.clickIds.wbraid) adIdentifiers.wbraid = e.clickIds.wbraid;
    if (Object.keys(adIdentifiers).length > 0) {
      event.adIdentifiers = adIdentifiers;
    }

    if (e.value !== null) {
      event.conversionValue = e.value;
      event.currency = e.currency;
    }

    const routedDestination = this.config.destinationIdMap?.[e.eventType];
    if (routedDestination) {
      event.destinationReferences = [routedDestination];
    }

    return event;
  }
}

function classifyGoogleFailure(
  status: number,
  body: Record<string, any>,
): "retryable" | "permanent" {
  if (status >= 500) return "retryable";
  if (status === 429) return "retryable";
  // A 401 is usually an expired token, which a refresh on the next attempt
  // fixes. A 403 is a genuine permissions problem that will not self-resolve.
  if (status === 401) return "retryable";
  if (status === 403) return "permanent";

  const reason = body?.error?.status as string | undefined;
  if (reason === "UNAVAILABLE" || reason === "DEADLINE_EXCEEDED" || reason === "ABORTED") {
    return "retryable";
  }
  return "permanent";
}

/**
 * Service-account token provider with caching.
 *
 * Tokens last an hour; requesting a fresh one per delivery would add a round
 * trip to every conversion and quickly hit Google's auth rate limits.
 */
export function createServiceAccountTokenProvider(params: {
  credentials: { client_email: string; private_key: string };
  impersonatedUser?: string | null;
}): () => Promise<string> {
  let cached: { token: string; expiresAt: number } | null = null;

  return async () => {
    // Refresh a minute early so a token never expires mid-flight.
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.token;
    }

    const { GoogleAuth } = await import("google-auth-library");
    const auth = new GoogleAuth({
      credentials: params.credentials,
      scopes: ["https://www.googleapis.com/auth/datamanager"],
      ...(params.impersonatedUser ? { clientOptions: { subject: params.impersonatedUser } } : {}),
    });

    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (!token.token) throw new Error("Google returned an empty access token");

    cached = {
      token: token.token,
      expiresAt: Date.now() + 55 * 60 * 1000,
    };
    return cached.token;
  };
}
