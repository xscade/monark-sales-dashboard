import type { ConversionEventType } from "@monark/core";

/**
 * The platform-neutral shape the outbox worker hands to every adapter.
 *
 * Nothing here uses Meta's or Google's vocabulary. Adapters translate at the
 * edge, which is what lets a platform API migration touch one file. That has
 * already happened once — Google moved offline conversion uploads out of the
 * Ads API into the Data Manager API in June 2026 — so the boundary earns its
 * keep rather than being speculative generality.
 */
export interface OutboundConversion {
  eventType: ConversionEventType;
  /** Doubles as Meta `event_id` and Google `transactionId`. */
  eventKey: string;
  occurredAt: Date;

  value: number | null;
  currency: string;

  /** Already hashed with the destination's rules. Raw PII never reaches here. */
  user: HashedUserData;
  clickIds: ClickIdentifiers;

  consent: {
    adUserData: "granted" | "denied" | "unspecified";
    adPersonalization: "granted" | "denied" | "unspecified";
  };

  /** Where the conversion physically happened, for action_source mapping. */
  context: {
    sourceUrl?: string | null;
    /** Truncated. Meta accepts it to improve match quality. */
    clientIpAddress?: string | null;
    clientUserAgent?: string | null;
    leadReference?: string | null;
    projectName?: string | null;
  };
}

export interface HashedUserData {
  emailSha256?: string | null;
  phoneSha256?: string | null;
  firstNameSha256?: string | null;
  lastNameSha256?: string | null;
  citySha256?: string | null;
  stateSha256?: string | null;
  postalCodeSha256?: string | null;
  countrySha256?: string | null;
  /** NOT hashed — Meta matches these verbatim. */
  fbp?: string | null;
  fbc?: string | null;
  metaLeadId?: string | null;
  externalId?: string | null;
}

export interface ClickIdentifiers {
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  fbclid?: string | null;
  ctwaClid?: string | null;
}

/**
 * Adapters never throw for platform-level failures.
 *
 * The worker needs to distinguish "retry in ten minutes" from "this will never
 * work, stop burning attempts and tell a human" — and an exception cannot carry
 * that distinction without the worker string-matching error messages, which is
 * how retry storms start.
 */
export interface DeliveryResult {
  ok: boolean;
  /**
   * `permanent` means do not retry: bad credentials, malformed payload,
   * rejected event name. These need a person, not another attempt.
   */
  failureKind?: "retryable" | "permanent";
  httpStatus?: number;
  traceId?: string | null;
  /** Meta returns per-request match quality; tracked to catch identifier
   *  coverage silently degrading over time. */
  matchQuality?: number | null;
  error?: string;
  requestPayload: unknown;
  responseBody?: unknown;
  durationMs: number;
  /** True when the destination was in dry-run: payload built and validated,
   *  nothing recorded by the platform. */
  dryRun: boolean;
}

export interface ConversionAdapter {
  readonly platform: string;
  send(events: OutboundConversion[]): Promise<DeliveryResult>;
}

/** Suggested backoff. Jitter is applied by the worker so a platform outage
 *  does not produce a synchronised thundering herd on recovery. */
export function backoffMs(attemptNumber: number): number {
  const base = Math.min(2 ** attemptNumber * 30_000, 6 * 60 * 60 * 1000);
  return base;
}

export const MAX_DELIVERY_ATTEMPTS = 8;
