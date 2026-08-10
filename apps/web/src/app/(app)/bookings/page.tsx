import Link from "next/link";
import { Card, DataTable, EmptyState, Td, Th } from "@/components/ui";
import { can, requirePermission } from "@/lib/auth";
import {
  listBookableUnits,
  listBookings,
  listCommercialLeads,
  listCommercialProjects,
} from "@/lib/commercial-queries";
import { formatDateTime, formatINR, maskPhoneDisplay } from "@/lib/format";
import { BookingCreateForm } from "./booking-create-form";

export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-700 dark:bg-zinc-950";

const BOOKING_STATUSES = ["token", "booked", "agreement_signed", "registered", "cancelled"];

const statusClass: Record<string, string> = {
  token: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300",
  booked: "bg-green-600 text-white",
  agreement_signed: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  registered: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

function BookingStatus({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${statusClass[status] ?? "bg-zinc-100 text-zinc-700"}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; status?: string; q?: string }>;
}) {
  const user = await requirePermission("bookings:read");
  const params = await searchParams;
  const mayWrite = can(user, "bookings:write");
  const [projects, bookings, leads, units] = await Promise.all([
    listCommercialProjects(user.orgId),
    listBookings(user.orgId, {
      projectId: params.project?.trim() || undefined,
      status: params.status?.trim() || undefined,
      search: params.q?.trim() || undefined,
    }),
    mayWrite ? listCommercialLeads(user.orgId) : Promise.resolve([]),
    mayWrite ? listBookableUnits(user.orgId) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Booking register</h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            Every entry is backed by a unit, buyer, booking row, and token payment.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/inventory"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Inventory
          </Link>
          <Link
            href="/reports"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Reports
          </Link>
        </div>
      </div>

      <Card>
        <form method="get" className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <input
            name="q"
            type="search"
            defaultValue={params.q ?? ""}
            placeholder="Booking, lead, buyer, phone, unit…"
            className={inputClass}
          />
          <select name="project" defaultValue={params.project ?? ""} className={inputClass}>
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={params.status ?? ""} className={inputClass}>
            <option value="">All statuses</option>
            {BOOKING_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status.replace(/_/g, " ")}
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

      {mayWrite && (
        <Card
          title="Register a token or booking"
          subtitle="The token payment, lead stage, unit state, audit entry, and conversion outbox commit together."
        >
          {leads.length === 0 || units.length === 0 ? (
            <EmptyState
              title="A project-matched lead and available unit are required"
              hint="Create inventory or reopen an eligible lead before registering money."
            />
          ) : <BookingCreateForm leads={leads} units={units} />}
        </Card>
      )}

      <Card title={`${bookings.length} bookings`} subtitle="Net collected subtracts refunds and ignores reversed payments.">
        {bookings.length === 0 ? (
          <EmptyState title="No matching bookings" hint="The register never infers bookings from lead stage alone." />
        ) : (
          <DataTable>
            <thead className="border-b border-zinc-100 dark:border-zinc-800">
              <tr>
                <Th>Booking</Th>
                <Th>Buyer</Th>
                <Th>Project / unit</Th>
                <Th>Status</Th>
                <Th className="text-right">Agreement</Th>
                <Th className="text-right">Net collected</Th>
                <Th>Milestone date</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {bookings.map((booking) => (
                <tr key={booking.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <Td>
                    <Link href={`/bookings/${booking.id}`} className="font-medium text-brand-600 hover:underline">
                      {booking.reference}
                    </Link>
                    <p className="mt-0.5 text-xs text-zinc-500">{booking.leadReference}</p>
                  </Td>
                  <Td>
                    <Link href={`/leads/${booking.leadId}`} className="font-medium hover:underline">
                      {booking.personName ?? "Unnamed"}
                    </Link>
                    <p className="tabular mt-0.5 text-xs text-zinc-500">
                      {maskPhoneDisplay(booking.primaryPhone)}
                    </p>
                  </Td>
                  <Td>
                    <p>{booking.projectName ?? "—"}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">{booking.unitLabel ?? "—"}</p>
                  </Td>
                  <Td><BookingStatus status={booking.status} /></Td>
                  <Td className="tabular text-right">{formatINR(booking.agreementValue, true)}</Td>
                  <Td className="tabular text-right font-medium">{formatINR(booking.collectedAmount, true)}</Td>
                  <Td className="whitespace-nowrap text-zinc-500">
                    {formatDateTime(booking.bookedAt ?? booking.tokenPaidAt ?? booking.createdAt)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>
    </div>
  );
}
