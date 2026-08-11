import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingStatusBadge, VerificationBadge } from "@/components/booking-status";
import { Card, DataTable, EmptyState, StatTile, SubmitButton, Td, Th } from "@/components/ui";
import { can, requirePermission } from "@/lib/auth";
import {
  advanceBookingAction,
  cancelBookingAction,
  recordPaymentAction,
} from "@/lib/commercial-actions";
import { getBookingDetail } from "@/lib/commercial-queries";
import { formatDateTime, formatINR } from "@/lib/format";
import { unverifiedAmount, verificationDrifted } from "@/lib/verification";

export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-700 dark:bg-zinc-950";

const NEXT_STATUS: Record<string, { status: "booked" | "agreement_signed" | "registered"; label: string } | undefined> = {
  token: { status: "booked", label: "Confirm booking" },
  booked: { status: "agreement_signed", label: "Mark agreement signed" },
  agreement_signed: { status: "registered", label: "Mark registered" },
};

export default async function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("bookings:read");
  const { id } = await params;
  const booking = await getBookingDetail(user.orgId, id);
  if (!booking) notFound();

  const mayWrite = can(user, "bookings:write");
  const mayCancel = can(user, "bookings:delete");
  const next = NEXT_STATUS[booking.status];
  const netCollected = Number(booking.collectedAmount) || 0;
  const agreementValue = Number(booking.agreementValue) || 0;
  const outstanding = Math.max(agreementValue - netCollected, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">{booking.reference}</h2>
            <BookingStatusBadge status={booking.status} />
            <VerificationBadge view={booking} showPending />
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {booking.projectName ?? "Project"} · {booking.unitLabel ?? "Unit unavailable"}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/bookings"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Back to register
          </Link>
          <Link
            href={`/leads/${booking.leadId}`}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Open lead
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Agreement value" value={formatINR(booking.agreementValue, true)} />
        <StatTile label="Token" value={formatINR(booking.tokenAmount, true)} />
        <StatTile label="Net collected" value={formatINR(netCollected, true)} tone="good" />
        <StatTile
          label="Outstanding"
          value={agreementValue ? formatINR(outstanding, true) : "—"}
          tone={outstanding > 0 ? "warn" : "default"}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Card title="Commercial record">
            <dl className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
              <Detail label="Buyer">
                <Link href={`/leads/${booking.leadId}`} className="font-medium hover:underline">
                  {booking.personName ?? "Unnamed"}
                </Link>
                <span className="block text-xs text-zinc-500">
                  {booking.primaryPhone ?? "No phone"} · {booking.leadReference}
                </span>
              </Detail>
              <Detail label="Closed by">{booking.closedByName ?? "Unassigned"}</Detail>
              <Detail label="Token received">{formatDateTime(booking.tokenPaidAt)}</Detail>
              <Detail label="Booking confirmed">{formatDateTime(booking.bookedAt)}</Detail>
              <Detail label="Agreement signed">{formatDateTime(booking.agreementSignedAt)}</Detail>
              <Detail label="Registered">{formatDateTime(booking.registeredAt)}</Detail>
              {booking.cancelledAt && (
                <Detail label="Cancelled">
                  {formatDateTime(booking.cancelledAt)}
                  <span className="block text-xs text-red-600">{booking.cancellationReason}</span>
                </Detail>
              )}
              {/* Accounts is a separate voice from sales; when it has spoken,
                  the record says so beside the milestones rather than only in
                  a badge at the top. */}
              <Detail label="Accounts verification">
                {booking.verificationStatus === "pending" ? (
                  <span className="text-zinc-500">Awaiting verification</span>
                ) : (
                  <>
                    <span>
                      {booking.verificationStatus === "validated" ? "Validated" : "No match"} by{" "}
                      {booking.verifiedByName ?? "accounts"} · {formatDateTime(booking.verifiedAt)}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      Checked against {formatINR(booking.verifiedAmount, true)} collected
                    </span>
                    {booking.verificationNote && (
                      <span className="block text-xs text-zinc-500">{booking.verificationNote}</span>
                    )}
                    {verificationDrifted(booking) && (
                      <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">
                        {formatINR(unverifiedAmount(booking), true)} received since — back with
                        accounts.
                      </span>
                    )}
                  </>
                )}
              </Detail>
            </dl>
          </Card>

          <Card title="Payments" subtitle="Refunds reduce net collected; reversed rows are retained for audit.">
            {booking.payments.length === 0 ? (
              <EmptyState title="No payments recorded" />
            ) : (
              <DataTable>
                <thead className="border-b border-zinc-100 dark:border-zinc-800">
                  <tr>
                    <Th>Received</Th>
                    <Th>Kind</Th>
                    <Th>Mode / reference</Th>
                    <Th>Recorded by</Th>
                    <Th className="text-right">Amount</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {booking.payments.map((payment) => (
                    <tr key={payment.id} className={payment.isReversed ? "opacity-50" : ""}>
                      <Td className="whitespace-nowrap">{formatDateTime(payment.receivedAt)}</Td>
                      <Td>
                        <span className={payment.kind === "refund" ? "text-red-600" : ""}>
                          {payment.kind.replace(/_/g, " ")}
                        </span>
                        {payment.isReversed && <span className="block text-xs">reversed</span>}
                      </Td>
                      <Td>
                        {payment.mode?.toUpperCase() ?? "—"}
                        {payment.reference && <span className="block text-xs text-zinc-500">{payment.reference}</span>}
                      </Td>
                      <Td>{payment.recordedByName ?? "—"}</Td>
                      <Td className={`tabular text-right font-medium ${payment.kind === "refund" ? "text-red-600" : ""}`}>
                        {payment.kind === "refund" ? "−" : ""}{formatINR(payment.amount)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </Card>
        </div>

        {mayWrite && (
          <aside className="space-y-5">
            <Card title={booking.status === "cancelled" ? "Record refund" : "Record payment"}>
                <form action={recordPaymentAction} className="space-y-3 p-4">
                  <input type="hidden" name="paymentId" value={randomUUID()} />
                  <input type="hidden" name="bookingId" value={booking.id} />
                  <Field label="Amount *" name="amount" type="number" min="0.01" step="0.01" required />
                  <label className="block">
                    <span className="mb-1 block text-xs text-zinc-500">Kind *</span>
                    <select
                      name="kind"
                      defaultValue={booking.status === "cancelled" ? "refund" : "instalment"}
                      className={inputClass}
                    >
                      {booking.status === "cancelled" ? (
                        <option value="refund">Refund</option>
                      ) : (
                        <>
                          {booking.status === "token" && <option value="token">Additional token</option>}
                          <option value="booking_amount">Booking amount</option>
                          <option value="instalment">Instalment</option>
                          <option value="registration">Registration</option>
                          <option value="refund">Refund</option>
                        </>
                      )}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-zinc-500">Mode *</span>
                    <select name="mode" defaultValue="neft" className={inputClass}>
                      <option value="upi">UPI</option>
                      <option value="neft">NEFT / RTGS</option>
                      <option value="cheque">Cheque</option>
                      <option value="card">Card</option>
                      <option value="cash">Cash</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <Field label="Reference" name="reference" placeholder="UTR / cheque number" />
                  <Field label="Received at" name="receivedAt" type="datetime-local" />
                  <SubmitButton className="w-full">
                    {booking.status === "cancelled" ? "Record refund" : "Record payment"}
                  </SubmitButton>
                </form>
            </Card>

            {next && (
              <Card title="Advance milestone">
                <form action={advanceBookingAction} className="space-y-3 p-4">
                  <input type="hidden" name="bookingId" value={booking.id} />
                  <input type="hidden" name="targetStatus" value={next.status} />
                  {next.status === "booked" && (
                    <Field
                      label="Agreement value *"
                      name="agreementValue"
                      type="number"
                      min="0.01"
                      step="0.01"
                      required={!booking.agreementValue}
                      defaultValue={booking.agreementValue ?? ""}
                    />
                  )}
                  <p className="text-xs text-zinc-500">
                    This updates the booking and inventory together
                    {next.status === "booked" ? ", closes the lead, and emits the booking outcome" : ""}.
                  </p>
                  <SubmitButton className="w-full">{next.label}</SubmitButton>
                </form>
              </Card>
            )}

            {mayCancel && booking.status !== "cancelled" && booking.status !== "registered" && (
              <Card title="Cancel booking" subtitle="Payments remain in the ledger; record any refund separately.">
                <form action={cancelBookingAction} className="space-y-3 p-4">
                  <input type="hidden" name="bookingId" value={booking.id} />
                  <textarea
                    name="reason"
                    required
                    minLength={3}
                    rows={3}
                    placeholder="Reason for cancellation"
                    className={inputClass}
                  />
                  <SubmitButton variant="danger" className="w-full">Cancel and release unit</SubmitButton>
                </form>
              </Card>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}

function Field({
  label,
  name,
  ...props
}: {
  label: string;
  name: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-zinc-500">{label}</span>
      <input name={name} {...props} className={inputClass} />
    </label>
  );
}
