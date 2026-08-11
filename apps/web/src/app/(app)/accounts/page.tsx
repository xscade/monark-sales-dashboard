import Link from "next/link";
import { BookingStatusBadge, VerificationBadge } from "@/components/booking-status";
import { Card, DataTable, EmptyState, StatTile, SubmitButton, Td, Th } from "@/components/ui";
import { can, requirePermission } from "@/lib/auth";
import { verifyBookingAction } from "@/lib/accounts-actions";
import {
  getVerificationSummary,
  listBookingsAwaitingVerification,
  listVerifiedBookings,
} from "@/lib/accounts-queries";
import { listCommercialProjects } from "@/lib/commercial-queries";
import { formatDateTime, formatINR, maskPhoneDisplay } from "@/lib/format";
import { unverifiedAmount, verificationDrifted } from "@/lib/verification";
import { SettingsFlash } from "../settings/settings-flash";

export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-700 dark:bg-zinc-950";

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{
    project?: string;
    q?: string;
    notice?: string;
    error?: string;
  }>;
}) {
  const user = await requirePermission("accounts:read");
  const params = await searchParams;
  const projectId = params.project?.trim() || undefined;
  const mayVerify = can(user, "accounts:verify");

  const [projects, summary, queue, decided] = await Promise.all([
    listCommercialProjects(user.orgId),
    getVerificationSummary(user.orgId, { projectId }),
    listBookingsAwaitingVerification(user.orgId, { projectId, search: params.q?.trim() }),
    listVerifiedBookings(user.orgId, { projectId, limit: 25 }),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Accounts verification</h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            Every booking amount, checked against the bank. Confirming marks it Validated
            everywhere the booking appears.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/bookings"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Booking register
          </Link>
          <Link
            href="/reports"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Reports
          </Link>
        </div>
      </div>

      <SettingsFlash notice={params.notice} error={params.error} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Awaiting verification"
          value={String(summary.pending)}
          hint={formatINR(summary.pendingValue, true)}
          tone={summary.pending ? "warn" : "good"}
        />
        <StatTile
          label="Validated"
          value={String(summary.validated)}
          hint={`${formatINR(summary.validatedValue, true)} confirmed`}
          tone="good"
        />
        <StatTile
          label="No match"
          value={String(summary.noMatch)}
          hint={formatINR(summary.noMatchValue, true)}
          tone={summary.noMatch ? "danger" : "default"}
        />
        <StatTile
          label="Re-check needed"
          value={String(summary.drifted)}
          hint={`${formatINR(summary.driftedValue, true)} received since sign-off`}
          tone={summary.drifted ? "warn" : "default"}
        />
      </section>

      <Card>
        <form method="get" className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <input
            name="q"
            type="search"
            defaultValue={params.q ?? ""}
            placeholder="Booking, lead, buyer, phone, unit…"
            className={inputClass}
          />
          <select name="project" defaultValue={projectId ?? ""} className={inputClass}>
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Apply filters
          </button>
        </form>
      </Card>

      <Card
        title={`${queue.length} awaiting a decision`}
        subtitle={
          mayVerify
            ? "Confirm once the receipt is traced in the bank. No match sends it back to sales with your note."
            : "Read-only: verifying requires the Accounts update permission."
        }
      >
        {queue.length === 0 ? (
          <EmptyState
            title="Nothing waiting on accounts"
            hint="New booking amounts appear here the moment they are registered."
          />
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {queue.map((booking) => {
              const drifted = verificationDrifted(booking);
              const outstanding = unverifiedAmount(booking);
              return (
                <li key={booking.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-64 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/bookings/${booking.id}`}
                          className="text-sm font-semibold text-brand-600 hover:underline"
                        >
                          {booking.reference}
                        </Link>
                        <BookingStatusBadge status={booking.status} />
                        <VerificationBadge view={booking} showPending />
                      </div>
                      <p className="mt-1 text-sm">
                        <Link href={`/leads/${booking.leadId}`} className="font-medium hover:underline">
                          {booking.personName ?? "Unnamed"}
                        </Link>
                        <span className="tabular text-zinc-500">
                          {" · "}
                          {maskPhoneDisplay(booking.primaryPhone)}
                        </span>
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {booking.projectName ?? "Project"} · {booking.unitLabel ?? "Unit unavailable"} ·
                        closed by {booking.closedByName ?? "unassigned"}
                      </p>

                      <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                        <Fact label="Net collected" value={formatINR(booking.collectedAmount, true)} strong />
                        <Fact label="Agreement" value={formatINR(booking.agreementValue, true)} />
                        <Fact label="Token" value={formatINR(booking.tokenAmount, true)} />
                        <Fact
                          label={`Last receipt · ${booking.paymentCount} total`}
                          value={
                            booking.lastPaymentAt
                              ? `${formatINR(booking.lastPaymentAmount, true)} · ${booking.lastPaymentMode?.toUpperCase() ?? "—"}`
                              : "None"
                          }
                          hint={booking.lastPaymentReference ?? formatDateTime(booking.lastPaymentAt)}
                        />
                      </dl>

                      {drifted && (
                        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                          Validated at {formatINR(booking.verifiedAmount, true)} on{" "}
                          {formatDateTime(booking.verifiedAt)}. {formatINR(outstanding, true)} has
                          come in since and is not covered by that sign-off.
                        </p>
                      )}
                      {booking.verificationStatus === "no_match" && booking.verificationNote && (
                        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300">
                          Flagged by {booking.verifiedByName ?? "accounts"} on{" "}
                          {formatDateTime(booking.verifiedAt)}: {booking.verificationNote}
                        </p>
                      )}
                    </div>

                    {mayVerify && (
                      <form action={verifyBookingAction} className="w-full max-w-xs space-y-2">
                        <input type="hidden" name="bookingId" value={booking.id} />
                        {/* Travels with the decision so a payment landing mid-review
                            cannot be silently swept into the confirmation. */}
                        <input type="hidden" name="seenAmount" value={booking.collectedAmount} />
                        <input
                          name="note"
                          maxLength={500}
                          placeholder="UTR or remark (required for No match)"
                          className={`${inputClass} text-xs`}
                        />
                        <div className="flex gap-2">
                          <button
                            type="submit"
                            name="decision"
                            value="validated"
                            className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"
                          >
                            Confirm
                          </button>
                          <button
                            type="submit"
                            name="decision"
                            value="no_match"
                            className="flex-1 rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
                          >
                            No match
                          </button>
                        </div>
                        <p className="text-[11px] leading-relaxed text-zinc-500">
                          Confirming validates {formatINR(booking.collectedAmount, true)} — the net
                          collected right now.
                        </p>
                      </form>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card
        title="Recent decisions"
        subtitle="The last 25 verification calls, with who made them."
      >
        {decided.length === 0 ? (
          <EmptyState title="No verification decisions yet" />
        ) : (
          <DataTable>
            <thead className="border-b border-zinc-100 dark:border-zinc-800">
              <tr>
                <Th>Booking</Th>
                <Th>Buyer</Th>
                <Th>Decision</Th>
                <Th className="text-right">Verified</Th>
                <Th className="text-right">Collected now</Th>
                <Th>Decided</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {decided.map((booking) => (
                <tr key={booking.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <Td>
                    <Link
                      href={`/bookings/${booking.id}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      {booking.reference}
                    </Link>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {booking.projectName ?? "—"} · {booking.unitLabel ?? "—"}
                    </p>
                  </Td>
                  <Td>{booking.personName ?? "Unnamed"}</Td>
                  <Td><VerificationBadge view={booking} showPending /></Td>
                  <Td className="tabular text-right">{formatINR(booking.verifiedAmount, true)}</Td>
                  <Td className="tabular text-right font-medium">
                    {formatINR(booking.collectedAmount, true)}
                  </Td>
                  <Td className="whitespace-nowrap text-zinc-500">
                    {formatDateTime(booking.verifiedAt)}
                    <span className="block text-xs">{booking.verifiedByName ?? "—"}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>

      <p className="text-xs leading-5 text-zinc-500">
        Verification never edits the booking. It records whether accounts could match the money, so
        the register and the bank can be seen to disagree instead of quietly averaging out. A
        validated booking whose collections move later returns to this queue for the difference —
        the original sign-off still stands for the amount that was checked.
      </p>
    </div>
  );
}

function Fact({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint?: string | null;
  strong?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className={`tabular mt-0.5 ${strong ? "text-sm font-semibold" : "text-sm"}`}>{value}</dd>
      {hint && <dd className="truncate text-[11px] text-zinc-500">{hint}</dd>}
    </div>
  );
}
