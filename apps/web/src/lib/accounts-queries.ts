import { getDb } from "@monark/db";
import { sql } from "drizzle-orm";
import type { VerificationStatus } from "./verification";

const db = () => getDb();

/**
 * Net collected for a booking: refunds subtract, reversed rows count for
 * nothing. Repeated across these queries because each one needs it against a
 * different driving table.
 */
const netCollected = sql`
  COALESCE(SUM(
    CASE WHEN pm.is_reversed THEN 0
         WHEN pm.kind = 'refund' THEN -pm.amount
         ELSE pm.amount END
  ), 0)
`;

export interface AccountsBookingRow {
  id: string;
  reference: string;
  status: string;
  leadId: string;
  leadReference: string;
  personName: string | null;
  primaryPhone: string | null;
  projectName: string | null;
  unitLabel: string | null;
  agreementValue: string | null;
  tokenAmount: string | null;
  collectedAmount: string;
  /** Latest money movement on the booking — what the accountant is matching. */
  lastPaymentAt: string | null;
  lastPaymentAmount: string | null;
  lastPaymentMode: string | null;
  lastPaymentReference: string | null;
  paymentCount: number;
  closedByName: string | null;
  bookedAt: string | null;
  tokenPaidAt: string | null;
  createdAt: string;
  verificationStatus: VerificationStatus;
  verifiedAmount: string | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
  verificationNote: string | null;
}

export interface AccountsSummary {
  /** Bookings with no decision yet. */
  pending: number;
  pendingValue: number;
  validated: number;
  validatedValue: number;
  noMatch: number;
  noMatchValue: number;
  /** Validated, but money has arrived since the decision. */
  drifted: number;
  driftedValue: number;
}

const bookingFacts = sql`
  SELECT b.id, b.reference, b.status, b.lead_id AS "leadId",
         l.reference AS "leadReference", p.full_name AS "personName",
         p.primary_phone AS "primaryPhone", pr.name AS "projectName",
         CASE WHEN u.id IS NULL THEN NULL
              ELSE CONCAT_WS(' · ', NULLIF(u.tower, ''), u.unit_number) END AS "unitLabel",
         b.agreement_value AS "agreementValue", b.token_amount AS "tokenAmount",
         COALESCE(pay.collected, 0)::text AS "collectedAmount",
         pay.last_received_at AS "lastPaymentAt",
         pay.last_amount AS "lastPaymentAmount",
         pay.last_mode AS "lastPaymentMode",
         pay.last_reference AS "lastPaymentReference",
         COALESCE(pay.payment_count, 0)::int AS "paymentCount",
         closer.name AS "closedByName",
         b.booked_at AS "bookedAt", b.token_paid_at AS "tokenPaidAt", b.created_at AS "createdAt",
         b.verification_status::text AS "verificationStatus",
         b.verified_amount AS "verifiedAmount", b.verified_at AS "verifiedAt",
         verifier.name AS "verifiedByName", b.verification_note AS "verificationNote"
  FROM bookings b
  JOIN leads l ON l.id = b.lead_id AND l.org_id = b.org_id
  JOIN persons p ON p.id = b.person_id AND p.org_id = b.org_id
  LEFT JOIN projects pr ON pr.id = b.project_id AND pr.org_id = b.org_id
  LEFT JOIN units u ON u.id = b.unit_id AND u.org_id = b.org_id
  LEFT JOIN users closer ON closer.id = b.closed_by_user_id AND closer.org_id = b.org_id
  LEFT JOIN users verifier ON verifier.id = b.verified_by_user_id AND verifier.org_id = b.org_id
  LEFT JOIN LATERAL (
    SELECT ${netCollected} AS collected,
           COUNT(*) FILTER (WHERE NOT pm.is_reversed)::int AS payment_count,
           MAX(pm.received_at) FILTER (WHERE NOT pm.is_reversed) AS last_received_at,
           (ARRAY_AGG(pm.amount ORDER BY pm.received_at DESC, pm.created_at DESC)
             FILTER (WHERE NOT pm.is_reversed))[1] AS last_amount,
           (ARRAY_AGG(pm.mode ORDER BY pm.received_at DESC, pm.created_at DESC)
             FILTER (WHERE NOT pm.is_reversed))[1] AS last_mode,
           (ARRAY_AGG(pm.reference ORDER BY pm.received_at DESC, pm.created_at DESC)
             FILTER (WHERE NOT pm.is_reversed))[1] AS last_reference
    FROM payments pm
    WHERE pm.org_id = b.org_id AND pm.booking_id = b.id
  ) pay ON true
`;

/**
 * A booking is back in front of the accountant when nobody has decided yet,
 * when the last decision was "no match", or when money has moved past the
 * figure that was signed off.
 */
const needsDecision = sql`(
  b.verification_status <> 'validated'
  OR ABS(COALESCE(pay.collected, 0) - COALESCE(b.verified_amount, 0)) >= 0.01
)`;

/**
 * The verification queue.
 *
 * Cancelled bookings are excluded: their remaining money question is a refund,
 * which is a different workflow and does not belong in a "does this receipt
 * match?" list.
 */
export async function listBookingsAwaitingVerification(
  orgId: string,
  filters: { projectId?: string; search?: string } = {},
): Promise<AccountsBookingRow[]> {
  const conditions = [sql`b.org_id = ${orgId}`, sql`b.status <> 'cancelled'`, needsDecision];
  if (filters.projectId) conditions.push(sql`b.project_id = ${filters.projectId}`);
  if (filters.search) {
    const term = `%${filters.search.replace(/[%_]/g, "").trim()}%`;
    conditions.push(sql`(
      b.reference ILIKE ${term}
      OR l.reference ILIKE ${term}
      OR COALESCE(p.full_name, '') ILIKE ${term}
      OR COALESCE(p.primary_phone, '') ILIKE ${term}
      OR COALESCE(u.unit_number, '') ILIKE ${term}
    )`);
  }

  const result = await db().execute(sql`
    ${bookingFacts}
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY
      -- A flagged mismatch is somebody waiting on an answer; it outranks a
      -- booking nobody has looked at yet.
      CASE b.verification_status WHEN 'no_match' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
      COALESCE(pay.last_received_at, b.booked_at, b.token_paid_at, b.created_at) DESC
    LIMIT 200
  `);
  return result.rows as unknown as AccountsBookingRow[];
}

/** Decisions already taken, newest first — the audit view of this screen. */
export async function listVerifiedBookings(
  orgId: string,
  filters: { projectId?: string; limit?: number } = {},
): Promise<AccountsBookingRow[]> {
  const conditions = [sql`b.org_id = ${orgId}`, sql`b.verified_at IS NOT NULL`];
  if (filters.projectId) conditions.push(sql`b.project_id = ${filters.projectId}`);

  const result = await db().execute(sql`
    ${bookingFacts}
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY b.verified_at DESC
    LIMIT ${Math.min(filters.limit ?? 25, 100)}
  `);
  return result.rows as unknown as AccountsBookingRow[];
}

export async function getVerificationSummary(
  orgId: string,
  filters: { projectId?: string } = {},
): Promise<AccountsSummary> {
  const projectId = filters.projectId ?? null;
  const result = await db().execute(sql`
    WITH facts AS (
      SELECT b.verification_status::text AS status,
             COALESCE(b.agreement_value, b.token_amount, 0) AS value,
             COALESCE(pay.collected, 0) AS collected,
             COALESCE(b.verified_amount, 0) AS verified
      FROM bookings b
      LEFT JOIN LATERAL (
        SELECT ${netCollected} AS collected
        FROM payments pm
        WHERE pm.org_id = b.org_id AND pm.booking_id = b.id
      ) pay ON true
      WHERE b.org_id = ${orgId} AND b.status <> 'cancelled'
        AND (${projectId}::uuid IS NULL OR b.project_id = ${projectId}::uuid)
    )
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
      COALESCE(SUM(value) FILTER (WHERE status = 'pending'), 0)::float AS "pendingValue",
      COUNT(*) FILTER (WHERE status = 'validated')::int AS validated,
      COALESCE(SUM(verified) FILTER (WHERE status = 'validated'), 0)::float AS "validatedValue",
      COUNT(*) FILTER (WHERE status = 'no_match')::int AS "noMatch",
      COALESCE(SUM(value) FILTER (WHERE status = 'no_match'), 0)::float AS "noMatchValue",
      COUNT(*) FILTER (WHERE status = 'validated' AND ABS(collected - verified) >= 0.01)::int AS drifted,
      COALESCE(SUM(collected - verified)
        FILTER (WHERE status = 'validated' AND ABS(collected - verified) >= 0.01), 0)::float AS "driftedValue"
    FROM facts
  `);

  return (
    (result.rows as unknown as AccountsSummary[])[0] ?? {
      pending: 0,
      pendingValue: 0,
      validated: 0,
      validatedValue: 0,
      noMatch: 0,
      noMatchValue: 0,
      drifted: 0,
      driftedValue: 0,
    }
  );
}

export interface VerificationTrendPoint {
  label: string;
  /** Agreement value of bookings accounts has confirmed. */
  validated: number;
  /** Agreement value still waiting on, or failing, verification. */
  unvalidated: number;
  validatedCount: number;
  unvalidatedCount: number;
}

/**
 * Validated versus unvalidated booking value across the period.
 *
 * Bucketed on the booking date rather than the verification date so the chart
 * answers "how much of what we sold that month has finance stood behind?" — a
 * verification-date series would just show how busy the accountant was.
 */
export async function getVerificationTrend(
  orgId: string,
  filters: { days: number; projectId?: string } = { days: 90 },
): Promise<VerificationTrendPoint[]> {
  const days = Math.max(7, Math.min(filters.days, 730));
  const grain = days <= 120 ? "week" : "month";
  const projectId = filters.projectId ?? null;

  const result = await db().execute(sql`
    WITH buckets AS (
      SELECT generate_series(
        date_trunc(${grain}, now() - ${days} * interval '1 day'),
        date_trunc(${grain}, now()),
        ('1 ' || ${grain})::interval
      ) AS bucket
    ), booked AS (
      SELECT date_trunc(${grain}, COALESCE(b.booked_at, b.token_paid_at, b.created_at)) AS bucket,
             b.verification_status::text AS status,
             COALESCE(b.agreement_value, b.token_amount, 0) AS value
      FROM bookings b
      WHERE b.org_id = ${orgId} AND b.status <> 'cancelled'
        AND COALESCE(b.booked_at, b.token_paid_at, b.created_at)
            >= date_trunc(${grain}, now() - ${days} * interval '1 day')
        AND (${projectId}::uuid IS NULL OR b.project_id = ${projectId}::uuid)
    )
    SELECT
      to_char(b.bucket, ${grain === "week" ? sql`'DD Mon'` : sql`'Mon YY'`}) AS label,
      COALESCE(SUM(k.value) FILTER (WHERE k.status = 'validated'), 0)::float AS validated,
      COALESCE(SUM(k.value) FILTER (WHERE k.status <> 'validated'), 0)::float AS unvalidated,
      COUNT(k.*) FILTER (WHERE k.status = 'validated')::int AS "validatedCount",
      COUNT(k.*) FILTER (WHERE k.status <> 'validated')::int AS "unvalidatedCount"
    FROM buckets b
    LEFT JOIN booked k ON k.bucket = b.bucket
    GROUP BY b.bucket
    ORDER BY b.bucket
  `);

  return result.rows as unknown as VerificationTrendPoint[];
}

/** Validated bookings for the reports table — the money finance stands behind. */
export interface ValidatedTransactionRow {
  id: string;
  reference: string;
  personName: string | null;
  projectName: string | null;
  unitLabel: string | null;
  agreementValue: string | null;
  verifiedAmount: string | null;
  collectedAmount: string;
  verifiedAt: string;
  verifiedByName: string | null;
  verificationNote: string | null;
  status: string;
}

export async function listValidatedTransactions(
  orgId: string,
  filters: { days: number; projectId?: string; limit?: number } = { days: 90 },
): Promise<ValidatedTransactionRow[]> {
  const days = Math.max(1, Math.min(filters.days, 730));
  const projectId = filters.projectId ?? null;

  const result = await db().execute(sql`
    SELECT b.id, b.reference, b.status, p.full_name AS "personName", pr.name AS "projectName",
           CASE WHEN u.id IS NULL THEN NULL
                ELSE CONCAT_WS(' · ', NULLIF(u.tower, ''), u.unit_number) END AS "unitLabel",
           b.agreement_value AS "agreementValue", b.verified_amount AS "verifiedAmount",
           COALESCE(pay.collected, 0)::text AS "collectedAmount",
           b.verified_at AS "verifiedAt", verifier.name AS "verifiedByName",
           b.verification_note AS "verificationNote"
    FROM bookings b
    JOIN persons p ON p.id = b.person_id AND p.org_id = b.org_id
    LEFT JOIN projects pr ON pr.id = b.project_id AND pr.org_id = b.org_id
    LEFT JOIN units u ON u.id = b.unit_id AND u.org_id = b.org_id
    LEFT JOIN users verifier ON verifier.id = b.verified_by_user_id AND verifier.org_id = b.org_id
    LEFT JOIN LATERAL (
      SELECT ${netCollected} AS collected
      FROM payments pm
      WHERE pm.org_id = b.org_id AND pm.booking_id = b.id
    ) pay ON true
    WHERE b.org_id = ${orgId}
      AND b.verification_status = 'validated'
      AND b.verified_at >= now() - ${days} * interval '1 day'
      AND (${projectId}::uuid IS NULL OR b.project_id = ${projectId}::uuid)
    ORDER BY b.verified_at DESC
    LIMIT ${Math.min(filters.limit ?? 50, 200)}
  `);

  return result.rows as unknown as ValidatedTransactionRow[];
}
