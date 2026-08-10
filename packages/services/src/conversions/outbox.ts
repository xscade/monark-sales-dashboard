import {
  GOOGLE_HASH_OPTIONS,
  META_HASH_OPTIONS,
  attributionClock,
  checkEligibility,
  hashCity,
  hashCountry,
  hashEmail,
  hashName,
  hashPhone,
  hashPostalCode,
  hashState,
  type ConversionEventType,
} from "@monark/core";
import {
  GoogleDataManagerAdapter,
  MAX_DELIVERY_ATTEMPTS,
  MetaCapiAdapter,
  backoffMs,
  createServiceAccountTokenProvider,
  type ConversionAdapter,
  type DeliveryResult,
  type OutboundConversion,
} from "@monark/connectors";
import {
  conversionDeliveries,
  conversionDeliveryAttempts,
  conversionDestinations,
  type Database,
} from "@monark/db";
import { eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { decryptCredentials } from "../crypto";

/**
 * Rows the claim query returns, already joined with everything the adapters
 * need. Loading this in one query rather than per-delivery matters: at a few
 * hundred deliveries a batch, an N+1 here would dominate the worker's runtime.
 */
interface ClaimedDelivery {
  deliveryId: string;
  orgId: string;
  destinationId: string;
  attemptCount: number;
  deliverBy: Date | null;

  eventType: ConversionEventType;
  eventKey: string;
  occurredAt: Date;
  value: string | null;
  currency: string;

  personId: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  countryCode: string | null;
  isSuppressed: boolean;

  leadReference: string | null;
  leadIsTest: boolean | null;
  leadSpamScore: number | null;
  leadLostReason: string | null;

  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  fbclid: string | null;
  ctwaClid: string | null;
  fbp: string | null;
  fbc: string | null;
  metaLeadId: string | null;
  landingPage: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  attributionExpiresAt: Date | null;

  projectName: string | null;
  consentAdUserData: string | null;
  consentAdPersonalization: string | null;
}

/**
 * Atomically claim a batch of due deliveries.
 *
 * `FOR UPDATE SKIP LOCKED` is what lets several worker processes run
 * concurrently without either double-sending a conversion or blocking each
 * other — each grabs a disjoint set of rows. Marking them `in_flight` in the
 * same statement closes the window where a crash could leave a row looking
 * claimable while a request is already in the air.
 */
async function claimDeliveries(db: Database, limit: number): Promise<ClaimedDelivery[]> {
  const result = await db.execute(sql`
    WITH claimed AS (
      UPDATE conversion_deliveries d
      SET status = 'in_flight',
          attempt_count = d.attempt_count + 1,
          updated_at = now()
      WHERE d.id IN (
        SELECT id FROM conversion_deliveries
        WHERE status IN ('pending', 'failed_retryable')
          AND next_attempt_at <= now()
        ORDER BY next_attempt_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      RETURNING d.*
    )
    SELECT
      c.id                          AS "deliveryId",
      c.org_id                      AS "orgId",
      c.destination_id              AS "destinationId",
      c.attempt_count               AS "attemptCount",
      c.deliver_by                  AS "deliverBy",
      e.event_type                  AS "eventType",
      e.event_key                   AS "eventKey",
      e.occurred_at                 AS "occurredAt",
      e.value                       AS "value",
      e.currency                    AS "currency",
      p.id                          AS "personId",
      p.full_name                   AS "fullName",
      p.first_name                  AS "firstName",
      p.last_name                   AS "lastName",
      p.primary_email               AS "primaryEmail",
      p.primary_phone               AS "primaryPhone",
      p.city                        AS "city",
      p.state                       AS "state",
      p.postal_code                 AS "postalCode",
      p.country_code                AS "countryCode",
      p.is_suppressed               AS "isSuppressed",
      l.reference                   AS "leadReference",
      l.is_test                     AS "leadIsTest",
      l.spam_score                  AS "leadSpamScore",
      l.lost_reason::text           AS "leadLostReason",
      t.gclid, t.gbraid, t.wbraid, t.fbclid,
      t.ctwa_clid                   AS "ctwaClid",
      t.fbp, t.fbc,
      t.meta_lead_id                AS "metaLeadId",
      t.landing_page                AS "landingPage",
      t.ip_address                  AS "ipAddress",
      t.user_agent                  AS "userAgent",
      t.attribution_expires_at      AS "attributionExpiresAt",
      pr.name                       AS "projectName",
      (
        SELECT cr.state::text FROM consent_records cr
        WHERE cr.person_id = p.id AND cr.purpose = 'ad_user_data'
        ORDER BY cr.created_at DESC LIMIT 1
      )                             AS "consentAdUserData",
      (
        SELECT cr.state::text FROM consent_records cr
        WHERE cr.person_id = p.id AND cr.purpose = 'ad_personalization'
        ORDER BY cr.created_at DESC LIMIT 1
      )                             AS "consentAdPersonalization"
    FROM claimed c
    JOIN conversion_events e ON e.id = c.conversion_event_id
    JOIN persons p           ON p.id = e.person_id
    LEFT JOIN leads l        ON l.id = e.lead_id
    LEFT JOIN lead_touchpoints t ON t.id = e.touchpoint_id
    LEFT JOIN projects pr    ON pr.id = e.project_id
  `);

  return result.rows as unknown as ClaimedDelivery[];
}

function toConsent(value: string | null): "granted" | "denied" | "unspecified" {
  if (value === "granted") return "granted";
  if (value === "denied") return "denied";
  return "unspecified";
}

/**
 * Build the platform-neutral payload, hashing PII with the destination's rules.
 *
 * Hashing happens HERE rather than at ingestion because Meta and Google
 * normalise phone numbers differently (digits-only vs E.164-with-plus). A
 * single stored digest cannot satisfy both, and reusing the wrong one produces
 * a silent 0% match rate with no error anywhere.
 */
function buildOutbound(row: ClaimedDelivery, platform: string): OutboundConversion {
  const opts = platform === "google_data_manager" ? GOOGLE_HASH_OPTIONS : META_HASH_OPTIONS;

  return {
    eventType: row.eventType,
    eventKey: row.eventKey,
    occurredAt: new Date(row.occurredAt),
    value: row.value != null ? Number(row.value) : null,
    currency: row.currency,
    user: {
      emailSha256: hashEmail(row.primaryEmail, opts),
      phoneSha256: hashPhone(row.primaryPhone, opts),
      firstNameSha256: hashName(row.firstName, opts),
      lastNameSha256: hashName(row.lastName, opts),
      citySha256: hashCity(row.city, opts),
      stateSha256: hashState(row.state, opts),
      postalCodeSha256: hashPostalCode(row.postalCode, opts),
      countrySha256: hashCountry(row.countryCode, opts),
      fbp: row.fbp,
      fbc: row.fbc,
      metaLeadId: row.metaLeadId,
      externalId: row.personId,
    },
    clickIds: {
      gclid: row.gclid,
      gbraid: row.gbraid,
      wbraid: row.wbraid,
      fbclid: row.fbclid,
      ctwaClid: row.ctwaClid,
    },
    consent: {
      adUserData: toConsent(row.consentAdUserData),
      adPersonalization: toConsent(row.consentAdPersonalization),
    },
    context: {
      sourceUrl: row.landingPage,
      clientIpAddress: row.ipAddress,
      clientUserAgent: row.userAgent,
      leadReference: row.leadReference,
      projectName: row.projectName,
    },
  };
}

function buildAdapter(destination: {
  platform: string;
  config: any;
  credentialsEncrypted: string | null;
  dryRun: boolean;
  eventNameMap: Partial<Record<ConversionEventType, string>>;
}): ConversionAdapter {
  const credentials = destination.credentialsEncrypted
    ? decryptCredentials(destination.credentialsEncrypted)
    : {};

  if (destination.platform === "meta_capi") {
    return new MetaCapiAdapter({
      datasetId: destination.config.datasetId,
      accessToken: credentials.accessToken ?? "",
      apiVersion: destination.config.apiVersion,
      testEventCode: destination.config.testEventCode ?? null,
      dryRun: destination.dryRun,
      eventNameMap: destination.eventNameMap,
    });
  }

  if (destination.platform === "google_data_manager") {
    return new GoogleDataManagerAdapter({
      operatingAccountId: destination.config.operatingAccountId,
      loginAccountId: destination.config.loginAccountId ?? null,
      productDestinationId: destination.config.productDestinationId,
      accountType: destination.config.accountType ?? "GOOGLE_ADS",
      getAccessToken: createServiceAccountTokenProvider({
        credentials: {
          client_email: credentials.client_email ?? "",
          private_key: credentials.private_key ?? "",
        },
        impersonatedUser: credentials.impersonatedUser ?? null,
      }),
      dryRun: destination.dryRun,
      eventNameMap: destination.eventNameMap,
    });
  }

  throw new Error(`Unsupported destination platform: ${destination.platform}`);
}

export interface ProcessResult {
  claimed: number;
  delivered: number;
  ineligible: number;
  expired: number;
  retrying: number;
  permanentlyFailed: number;
  /** Claimed but released unprocessed because the time budget ran out. */
  deferred: number;
  timedOut: boolean;
  durationMs: number;
}

export interface ProcessOptions {
  batchSize?: number;
  /**
   * Wall-clock budget, for serverless.
   *
   * Vercel kills a function at its maxDuration with no warning and no chance to
   * clean up. Rows already claimed as `in_flight` would then sit stranded until
   * the stall-reclaim sweep 30 minutes later — which, given Meta's 7-day
   * event_time limit, is lost time we cannot get back.
   *
   * So we stop claiming new work before the axe falls and explicitly release
   * anything we did not get to.
   */
  timeBudgetMs?: number;
}

export async function processOutbox(
  db: Database,
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  const startedAt = Date.now();
  const batchSize = options.batchSize ?? 200;
  const timeBudgetMs = options.timeBudgetMs ?? Number.POSITIVE_INFINITY;

  const rows = await claimDeliveries(db, batchSize);

  const result: ProcessResult = {
    claimed: rows.length,
    delivered: 0,
    ineligible: 0,
    expired: 0,
    retrying: 0,
    permanentlyFailed: 0,
    deferred: 0,
    timedOut: false,
    durationMs: 0,
  };
  if (rows.length === 0) {
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  // Group by destination so each platform gets one batched request rather than
  // one request per conversion.
  const byDestination = new Map<string, ClaimedDelivery[]>();
  for (const row of rows) {
    const list = byDestination.get(row.destinationId) ?? [];
    list.push(row);
    byDestination.set(row.destinationId, list);
  }

  const now = new Date();

  for (const [destinationId, deliveries] of byDestination) {
    // Check before each destination rather than each row: an in-flight HTTP
    // call must never be abandoned halfway, because we would not know whether
    // the platform recorded the conversion.
    if (Date.now() - startedAt > timeBudgetMs) {
      result.deferred += await releaseUnprocessed(db, deliveries);
      result.timedOut = true;
      continue;
    }

    const [destination] = await db
      .select()
      .from(conversionDestinations)
      .where(eq(conversionDestinations.id, destinationId))
      .limit(1);

    if (!destination) {
      await markPermanent(db, deliveries, "Destination no longer exists");
      result.permanentlyFailed += deliveries.length;
      continue;
    }

    const mappings = await db.execute(sql`
      SELECT event_type::text AS "eventType",
             platform_event_name AS "platformEventName"
      FROM conversion_event_mappings
      WHERE destination_id = ${destinationId} AND is_enabled = true
    `);
    const eventNameMap = Object.fromEntries(
      (mappings.rows as { eventType: string; platformEventName: string }[]).map((m) => [
        m.eventType,
        m.platformEventName,
      ]),
    ) as Partial<Record<ConversionEventType, string>>;

    // ---------------------------------------------------------------
    // Eligibility and expiry, before anything leaves the building
    // ---------------------------------------------------------------
    const sendable: ClaimedDelivery[] = [];

    for (const row of deliveries) {
      // Expired is a distinct outcome from failed. It means the attribution
      // window closed — usually because the sales cycle outran Google's 90-day
      // click window — and no amount of retrying will help.
      if (row.deliverBy && new Date(row.deliverBy) < now) {
        await markStatus(db, row.deliveryId, "expired", {
          lastError: "Attribution/delivery window closed before delivery",
        });
        result.expired++;
        continue;
      }

      const clock = attributionClock(
        row.attributionExpiresAt ? new Date(row.attributionExpiresAt) : null,
        now,
      );

      const eligibility = checkEligibility({
        consent: {
          adUserData: toConsent(row.consentAdUserData),
          adPersonalization: toConsent(row.consentAdPersonalization),
        },
        identifiers: {
          hasClickId: Boolean(row.gclid || row.gbraid || row.wbraid || row.fbclid || row.ctwaClid),
          hasHashedEmail: Boolean(row.primaryEmail),
          hasHashedPhone: Boolean(row.primaryPhone),
          hasFbp: Boolean(row.fbp),
        },
        lead: {
          isTest: row.leadIsTest ?? false,
          spamScore: row.leadSpamScore ?? 0,
          lostReason: row.leadLostReason,
        },
        person: { isSuppressed: row.isSuppressed },
        destination: {
          isEnabled: destination.isEnabled,
          hasMapping: Boolean(eventNameMap[row.eventType]),
        },
        window: { isExpired: clock.isExpired },
      });

      if (!eligibility.eligible) {
        // Terminal, and deliberately NOT an error — the gate did its job.
        await markStatus(db, row.deliveryId, "ineligible", {
          ineligibleReason: eligibility.reason,
        });
        result.ineligible++;
        continue;
      }

      sendable.push(row);
    }

    if (sendable.length === 0) continue;

    let adapter: ConversionAdapter;
    try {
      adapter = buildAdapter({
        platform: destination.platform,
        config: destination.config,
        credentialsEncrypted: destination.credentialsEncrypted,
        dryRun: destination.dryRun,
        eventNameMap,
      });
    } catch (err) {
      await markPermanent(db, sendable, err instanceof Error ? err.message : String(err));
      result.permanentlyFailed += sendable.length;
      continue;
    }

    const payloads = sendable.map((row) => buildOutbound(row, destination.platform));

    let deliveryResult: DeliveryResult;
    try {
      deliveryResult = await adapter.send(payloads);
    } catch (err) {
      // An adapter throwing is a bug in our code, not a platform failure.
      // Retry, but surface it loudly.
      deliveryResult = {
        ok: false,
        failureKind: "retryable",
        error: `Adapter threw: ${err instanceof Error ? err.message : String(err)}`,
        requestPayload: null,
        durationMs: 0,
        dryRun: destination.dryRun,
      };
    }

    for (const row of sendable) {
      await db.insert(conversionDeliveryAttempts).values({
        id: randomUUID(),
        orgId: row.orgId,
        deliveryId: row.deliveryId,
        attemptNumber: row.attemptCount,
        httpStatus: deliveryResult.httpStatus ?? null,
        durationMs: deliveryResult.durationMs,
        requestPayload: deliveryResult.requestPayload as never,
        responseBody: deliveryResult.responseBody as never,
        error: deliveryResult.error ?? null,
      });
    }

    if (deliveryResult.ok) {
      const status = destination.dryRun ? "skipped_dry_run" : "delivered";
      for (const row of sendable) {
        await markStatus(db, row.deliveryId, status, {
          deliveredAt: now,
          requestPayload: deliveryResult.requestPayload,
          responseBody: deliveryResult.responseBody,
          platformTraceId: deliveryResult.traceId ?? null,
        });
      }
      result.delivered += sendable.length;

      await db
        .update(conversionDestinations)
        .set({ lastSuccessAt: now, lastError: null })
        .where(eq(conversionDestinations.id, destinationId));
      continue;
    }

    const isPermanent =
      deliveryResult.failureKind === "permanent" ||
      sendable.some((r) => r.attemptCount >= MAX_DELIVERY_ATTEMPTS);

    for (const row of sendable) {
      if (isPermanent) {
        await markStatus(db, row.deliveryId, "failed_permanent", {
          lastError: deliveryResult.error,
          responseBody: deliveryResult.responseBody,
        });
        result.permanentlyFailed++;
      } else {
        // Full jitter. Without it, a platform outage produces a synchronised
        // herd of retries the moment it recovers, which is a reliable way to
        // get rate limited immediately after coming back.
        const base = backoffMs(row.attemptCount);
        const delay = Math.floor(Math.random() * base);
        await markStatus(db, row.deliveryId, "failed_retryable", {
          lastError: deliveryResult.error,
          responseBody: deliveryResult.responseBody,
          nextAttemptAt: new Date(now.getTime() + delay),
        });
        result.retrying++;
      }
    }

    await db
      .update(conversionDestinations)
      .set({ lastErrorAt: now, lastError: deliveryResult.error ?? "Unknown error" })
      .where(eq(conversionDestinations.id, destinationId));
  }

  result.durationMs = Date.now() - startedAt;
  return result;
}

/**
 * Hand claimed-but-unattempted rows back to the queue.
 *
 * `attempt_count` is decremented because we never actually called the platform.
 * Without that, a cron that repeatedly runs out of budget would burn through
 * the retry allowance and mark deliveries permanently failed having never made
 * a single request — a failure mode that looks exactly like the platform
 * rejecting us.
 */
async function releaseUnprocessed(db: Database, rows: ClaimedDelivery[]): Promise<number> {
  if (rows.length === 0) return 0;

  const released = await db
    .update(conversionDeliveries)
    .set({
      status: "pending",
      attemptCount: sql`GREATEST(${conversionDeliveries.attemptCount} - 1, 0)`,
      nextAttemptAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      inArray(
        conversionDeliveries.id,
        rows.map((r) => r.deliveryId),
      ),
    )
    .returning({ id: conversionDeliveries.id });

  return released.length;
}

async function markStatus(
  db: Database,
  deliveryId: string,
  status:
    | "delivered"
    | "failed_retryable"
    | "failed_permanent"
    | "ineligible"
    | "expired"
    | "skipped_dry_run",
  fields: {
    lastError?: string | null;
    ineligibleReason?: string | null;
    nextAttemptAt?: Date;
    deliveredAt?: Date;
    requestPayload?: unknown;
    responseBody?: unknown;
    platformTraceId?: string | null;
  } = {},
): Promise<void> {
  await db
    .update(conversionDeliveries)
    .set({
      status,
      updatedAt: new Date(),
      lastError: fields.lastError ?? null,
      ineligibleReason: fields.ineligibleReason ?? null,
      ...(fields.nextAttemptAt ? { nextAttemptAt: fields.nextAttemptAt } : {}),
      ...(fields.deliveredAt ? { deliveredAt: fields.deliveredAt } : {}),
      ...(fields.requestPayload !== undefined
        ? { requestPayload: fields.requestPayload as never }
        : {}),
      ...(fields.responseBody !== undefined
        ? { responseBody: fields.responseBody as never }
        : {}),
      ...(fields.platformTraceId !== undefined
        ? { platformTraceId: fields.platformTraceId }
        : {}),
    })
    .where(eq(conversionDeliveries.id, deliveryId));
}

async function markPermanent(
  db: Database,
  rows: ClaimedDelivery[],
  error: string,
): Promise<void> {
  for (const row of rows) {
    await markStatus(db, row.deliveryId, "failed_permanent", { lastError: error });
  }
}

/**
 * Outbox lag, in minutes, for the oldest undelivered event.
 *
 * This is a data-loss alarm rather than a latency metric. Meta rejects any
 * event whose `event_time` is more than 7 days old, so a queue that has been
 * stuck long enough will start losing conversions permanently — and it will do
 * so silently, because nothing in the CRM looks broken.
 */
export async function getOutboxLagMinutes(db: Database): Promise<number> {
  const result = await db.execute(sql`
    SELECT COALESCE(
      EXTRACT(EPOCH FROM (now() - MIN(e.occurred_at))) / 60, 0
    ) AS lag
    FROM conversion_deliveries d
    JOIN conversion_events e ON e.id = d.conversion_event_id
    WHERE d.status IN ('pending', 'failed_retryable', 'in_flight')
  `);
  const rows = result.rows as { lag: string | number }[];
  return Math.round(Number(rows[0]?.lag ?? 0));
}

/**
 * Recover deliveries stranded in `in_flight` by a worker crash.
 *
 * Without this they sit there forever: the claim query only looks at `pending`
 * and `failed_retryable`, so a process killed mid-batch would silently orphan
 * everything it had claimed.
 */
export async function reclaimStalled(db: Database, olderThanMinutes = 30): Promise<number> {
  const result = await db.execute(sql`
    UPDATE conversion_deliveries
    SET status = 'failed_retryable',
        next_attempt_at = now(),
        last_error = 'Reclaimed after worker stall',
        updated_at = now()
    WHERE status = 'in_flight'
      AND updated_at < now() - (${olderThanMinutes} || ' minutes')::interval
    RETURNING id
  `);
  return result.rows.length;
}
