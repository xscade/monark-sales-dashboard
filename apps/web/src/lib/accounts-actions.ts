"use server";

import { randomUUID } from "node:crypto";
import { auditLogs, getDb } from "@monark/db";
import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "./auth";
import { publishChange } from "./realtime";

const verifySchema = z
  .object({
    bookingId: z.string().uuid(),
    decision: z.enum(["validated", "no_match"]),
    note: z.preprocess(
      (value) => String(value ?? "").trim() || null,
      z.string().max(500).nullable(),
    ),
    /**
     * What the accountant saw on screen when they decided.
     *
     * Money can land between the page rendering and the button being pressed.
     * Confirming then would silently vouch for a figure the person never
     * looked at, so the amount travels with the decision and a mismatch is
     * rejected rather than absorbed.
     */
    seenAmount: z.preprocess(
      (value) => Number(String(value ?? "0")),
      z.number().finite().min(0),
    ),
  })
  .superRefine((value, context) => {
    if (value.decision === "no_match" && (value.note?.length ?? 0) < 3) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["note"],
        message: "Say what does not match — sales cannot act on a bare flag",
      });
    }
  });

function withFlash(path: string, key: "notice" | "error", message: string): string {
  const url = new URL(path, "https://monark.local");
  url.searchParams.set(key, message);
  return `${url.pathname}${url.search}`;
}

class VerificationError extends Error {}

/**
 * Record the accounts decision on one booking.
 *
 * Deliberately the only write this role has. An accountant confirming that
 * money arrived must not be able to change the amount they are confirming —
 * that separation is the entire reason this queue exists rather than a field on
 * the booking form.
 */
export async function verifyBookingAction(formData: FormData): Promise<void> {
  const actor = await requirePermission("accounts:verify");
  const returnTo = "/accounts";
  const parsed = verifySchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    redirect(withFlash(returnTo, "error", parsed.error.issues[0]?.message ?? "Invalid decision"));
  }
  const input = parsed.data;
  let bookingReference = "";

  try {
    await getDb().transaction(async (tx) => {
      const result = await tx.execute(sql`
        SELECT b.id, b.reference, b.status, b.verification_status::text AS "verificationStatus",
               b.verified_amount AS "verifiedAmount",
               COALESCE(pay.collected, 0)::text AS "collectedAmount"
        FROM bookings b
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(
            CASE WHEN pm.is_reversed THEN 0
                 WHEN pm.kind = 'refund' THEN -pm.amount
                 ELSE pm.amount END
          ), 0) AS collected
          FROM payments pm
          WHERE pm.org_id = b.org_id AND pm.booking_id = b.id
        ) pay ON true
        WHERE b.org_id = ${actor.orgId} AND b.id = ${input.bookingId}
        FOR UPDATE OF b
      `);
      const booking = (result.rows as unknown as {
        id: string;
        reference: string;
        status: string;
        verificationStatus: string;
        verifiedAmount: string | null;
        collectedAmount: string;
      }[])[0];

      if (!booking) throw new VerificationError("Booking not found");
      if (booking.status === "cancelled") {
        throw new VerificationError("A cancelled booking is a refund question, not a match");
      }

      bookingReference = booking.reference;
      const collected = Number(booking.collectedAmount);
      if (Math.abs(collected - input.seenAmount) >= 0.01) {
        throw new VerificationError(
          "Payments changed while this was open — reload and check the new amount",
        );
      }

      const now = new Date();
      await tx.execute(sql`
        UPDATE bookings
        SET verification_status = ${input.decision}::booking_verification_status,
            verified_by_user_id = ${actor.id},
            verified_at = ${now},
            verification_note = ${input.note},
            -- A no-match snapshot records what was rejected, so a later
            -- re-check can tell "still the same disputed figure" from "they
            -- have since paid something".
            verified_amount = ${collected.toFixed(2)},
            updated_at = ${now}
        WHERE org_id = ${actor.orgId} AND id = ${booking.id}
      `);

      await tx.insert(auditLogs).values({
        id: randomUUID(),
        orgId: actor.orgId,
        actorUserId: actor.id,
        actorType: "user",
        action: input.decision === "validated" ? "booking.validated" : "booking.verification_no_match",
        entityType: "booking",
        entityId: booking.id,
        before: {
          verificationStatus: booking.verificationStatus,
          verifiedAmount: booking.verifiedAmount,
        },
        after: {
          verificationStatus: input.decision,
          verifiedAmount: collected.toFixed(2),
          note: input.note,
        },
      });
    });
  } catch (error) {
    if (error instanceof VerificationError) {
      redirect(withFlash(returnTo, "error", error.message));
    }
    throw error;
  }

  revalidatePath(returnTo);
  revalidatePath("/bookings");
  revalidatePath(`/bookings/${input.bookingId}`);
  revalidatePath("/reports");
  revalidatePath("/customers");
  revalidatePath("/");
  await publishChange(actor.orgId, "accounts");
  redirect(
    withFlash(
      returnTo,
      "notice",
      input.decision === "validated"
        ? `${bookingReference} marked validated`
        : `${bookingReference} flagged as no match`,
    ),
  );
}
