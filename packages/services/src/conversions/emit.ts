import { randomUUID } from "node:crypto";
import {
  computeDeliverBy,
  isSendable,
  type ConversionEventType,
} from "@monark/core";
import {
  conversionDeliveries,
  conversionDestinations,
  conversionEventMappings,
  conversionEvents,
} from "@monark/db";
import { and, eq } from "drizzle-orm";
import type { Tx } from "../types";

export interface EmitConversionParams {
  orgId: string;
  eventType: ConversionEventType;
  personId: string;
  leadId?: string | null;
  projectId?: string | null;
  touchpointId?: string | null;
  occurredAt: Date;
  /**
   * Stable identity for this event.
   *
   * Callers MUST derive it from the business fact, never randomly — e.g.
   * `visit:{visitId}:completed`. That is what makes emission idempotent: a
   * double-clicked check-in button produces the same key, hits the unique
   * index, and is silently ignored instead of reporting two site visits.
   *
   * For `lead_created` pass the browser-generated event id so the client-side
   * Meta Pixel event and this server-side event collapse into one conversion.
   */
  eventKey: string;
  value?: number | null;
  currency?: string;
  valueModelVersion?: number | null;
  stageAtEvent?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Attribution expiry from the originating touchpoint, if any. */
  attributionExpiresAt?: Date | null;
}

export interface EmitResult {
  eventId: string;
  /** False when an event with this key already existed. */
  created: boolean;
  deliveriesCreated: number;
}

/**
 * Write a conversion event and fan it out to every enabled destination.
 *
 * MUST be called inside the same transaction as the business change that
 * caused it. This is the transactional-outbox pattern, and the reason for it is
 * concrete: if we called Meta inline instead, then either
 *
 *   - the HTTP call happens before commit, and a rolled-back transaction has
 *     already told Meta about a site visit that never happened, or
 *   - it happens after commit, and a crash in between loses the conversion
 *     with no record that it was ever owed.
 *
 * Writing the intent to the same database, in the same transaction, makes the
 * whole thing atomic. A separate worker then delivers it with retries.
 */
export async function emitConversionEvent(
  tx: Tx,
  params: EmitConversionParams,
): Promise<EmitResult> {
  // Internal-only events (cancellations, disqualifications) are recorded for
  // the value model but never fanned out — neither platform accepts negative
  // conversions, and a disqualified lead must not reach them at all.
  const sendable = isSendable(params.eventType);

  const inserted = await tx
    .insert(conversionEvents)
    .values({
      id: randomUUID(),
      orgId: params.orgId,
      eventType: params.eventType,
      leadId: params.leadId ?? null,
      personId: params.personId,
      projectId: params.projectId ?? null,
      touchpointId: params.touchpointId ?? null,
      eventKey: params.eventKey,
      occurredAt: params.occurredAt,
      value: params.value != null ? String(params.value) : null,
      currency: params.currency ?? "INR",
      valueModelVersion: params.valueModelVersion ?? null,
      stageAtEvent: params.stageAtEvent as never,
      sourceEntityType: params.sourceEntityType ?? null,
      sourceEntityId: params.sourceEntityId ?? null,
      metadata: params.metadata ?? null,
    })
    // Idempotency. A retried webhook or a double-clicked button must not
    // produce two conversions.
    .onConflictDoNothing({ target: [conversionEvents.orgId, conversionEvents.eventKey] })
    .returning({ id: conversionEvents.id });

  const existing = inserted[0];
  if (!existing) {
    const [row] = await tx
      .select({ id: conversionEvents.id })
      .from(conversionEvents)
      .where(
        and(
          eq(conversionEvents.orgId, params.orgId),
          eq(conversionEvents.eventKey, params.eventKey),
        ),
      )
      .limit(1);
    return { eventId: row?.id ?? "", created: false, deliveriesCreated: 0 };
  }

  if (!sendable) {
    return { eventId: existing.id, created: true, deliveriesCreated: 0 };
  }

  // Fan out only to destinations that are enabled AND have this event mapped.
  // An unmapped event is a deliberate configuration choice, not an error.
  const targets = await tx
    .select({
      destinationId: conversionDestinations.id,
      platform: conversionDestinations.platform,
      mappingEnabled: conversionEventMappings.isEnabled,
    })
    .from(conversionDestinations)
    .innerJoin(
      conversionEventMappings,
      eq(conversionEventMappings.destinationId, conversionDestinations.id),
    )
    .where(
      and(
        eq(conversionDestinations.orgId, params.orgId),
        eq(conversionDestinations.isEnabled, true),
        eq(conversionEventMappings.eventType, params.eventType),
        eq(conversionEventMappings.isEnabled, true),
      ),
    );

  if (targets.length === 0) {
    return { eventId: existing.id, created: true, deliveriesCreated: 0 };
  }

  const rows = targets.map((t) => ({
    id: randomUUID(),
    orgId: params.orgId,
    conversionEventId: existing.id,
    destinationId: t.destinationId,
    status: "pending" as const,
    // Each platform has its own deadline: Meta's 7-day event_time limit,
    // Google's 90-day click window. Computed once, at emission.
    deliverBy: computeDeliverBy({
      platform: t.platform,
      eventOccurredAt: params.occurredAt,
      attributionExpiresAt: params.attributionExpiresAt ?? null,
    }),
  }));

  await tx
    .insert(conversionDeliveries)
    .values(rows)
    .onConflictDoNothing({
      target: [conversionDeliveries.conversionEventId, conversionDeliveries.destinationId],
    });

  return { eventId: existing.id, created: true, deliveriesCreated: rows.length };
}

/**
 * Deterministic event keys.
 *
 * Every caller goes through here so the "derive from the business fact, never
 * randomly" rule is enforced by construction rather than by convention.
 */
export const eventKeyFor = {
  leadCreated: (leadId: string, browserEventId?: string | null) =>
    // Prefer the browser's id so the Pixel and CAPI events deduplicate.
    browserEventId ? `lead:${leadId}:created:${browserEventId}` : `lead:${leadId}:created`,
  stageEntered: (leadId: string, stage: string) => `lead:${leadId}:stage:${stage}`,
  visitCompleted: (visitId: string) => `visit:${visitId}:completed`,
  visitScheduled: (visitId: string) => `visit:${visitId}:scheduled`,
  unitShortlisted: (leadId: string, unitId: string) => `lead:${leadId}:shortlist:${unitId}`,
  tokenPaid: (bookingId: string) => `booking:${bookingId}:token`,
  bookingConfirmed: (bookingId: string) => `booking:${bookingId}:confirmed`,
  saleCompleted: (bookingId: string) => `booking:${bookingId}:sale`,
  bookingCancelled: (bookingId: string) => `booking:${bookingId}:cancelled`,
};
