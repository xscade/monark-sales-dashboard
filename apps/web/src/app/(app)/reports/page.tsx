import Link from "next/link";
import { Card, DataTable, EmptyState, SourceBadge, StatTile, Td, Th } from "@/components/ui";
import { can, requirePermission } from "@/lib/auth";
import { getCashMovement, getCommercialReports, listCommercialProjects } from "@/lib/commercial-queries";
import {
  getVerificationSummary,
  getVerificationTrend,
  listValidatedTransactions,
} from "@/lib/accounts-queries";
import { CashMovementChart } from "@/components/cash-movement-chart";
import { VerificationChart } from "@/components/verification-chart";
import { BookingStatusBadge } from "@/components/booking-status";
import { getWalkInLinkPerformance } from "@/lib/walk-in-link-queries";
import { WALK_IN_LINK_TYPE_LABELS } from "@/lib/walk-in-links";
import { formatDateTime, formatINR, formatNumber, formatPercent } from "@/lib/format";

export const dynamic = "force-dynamic";

const selectClass =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; project?: string }>;
}) {
  const user = await requirePermission("reports:read");
  const params = await searchParams;
  const days = Math.max(1, Math.min(Number(params.days) || 90, 730));
  const projectId = params.project?.trim() || undefined;
  const [
    projects,
    report,
    channels,
    cashMovement,
    verification,
    verificationTrend,
    validatedTransactions,
  ] = await Promise.all([
    listCommercialProjects(user.orgId),
    getCommercialReports(user.orgId, { days, projectId }),
    getWalkInLinkPerformance(user.orgId),
    getCashMovement(user.orgId, { days, projectId }),
    getVerificationSummary(user.orgId, { projectId }),
    getVerificationTrend(user.orgId, { days, projectId }),
    listValidatedTransactions(user.orgId, { days, projectId, limit: 50 }),
  ]);
  const refundedTotal = cashMovement.reduce((sum, point) => sum + point.refunded, 0);
  const bookingsAwaitingVerification = verification.pending + verification.noMatch;
  const verifiedShare =
    verification.validated + bookingsAwaitingVerification > 0
      ? verification.validated / (verification.validated + bookingsAwaitingVerification)
      : 0;

  const funnelRows = [
    { label: "Leads created", value: report.funnel.leads },
    { label: "Ever qualified", value: report.funnel.qualified },
    { label: "Visit scheduled (actual visit row)", value: report.funnel.scheduledVisits },
    { label: "Arrived / completed visit", value: report.funnel.completedVisits },
    { label: "Token booking rows", value: report.funnel.tokenBookings },
    { label: "Confirmed booking rows", value: report.funnel.confirmedBookings },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Commercial reports</h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            Inventory, funnel, sales, campaign, and collection outcomes from business facts.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/inventory"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Inventory
          </Link>
          <Link
            href="/bookings"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Bookings
          </Link>
        </div>
      </div>

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3 p-4">
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-500">Period</span>
            <select name="days" defaultValue={String(days)} className={selectClass}>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="180">Last 180 days</option>
              <option value="365">Last 365 days</option>
              <option value="730">Last 2 years</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-500">Project</span>
            <select name="project" defaultValue={projectId ?? ""} className={selectClass}>
              <option value="">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Apply
          </button>
        </form>
      </Card>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Inventory now</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          <StatTile label="Total" value={formatNumber(report.inventory.total)} />
          <StatTile label="Available" value={formatNumber(report.inventory.available)} tone="good" />
          <StatTile label="Held" value={formatNumber(report.inventory.held)} tone="warn" />
          <StatTile label="Token paid" value={formatNumber(report.inventory.tokenPaid)} />
          <StatTile label="Booked" value={formatNumber(report.inventory.booked)} />
          <StatTile label="Registered" value={formatNumber(report.inventory.registered)} />
          <StatTile label="Blocked" value={formatNumber(report.inventory.blocked)} />
          <StatTile label="Available GDV" value={formatINR(report.inventory.availableValue, true)} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Booking position now · cash movement last {days} days</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <StatTile label="Active now" value={formatNumber(report.bookings.active)} />
          <StatTile label={`Cancelled · ${days}d`} value={formatNumber(report.bookings.cancelled)} tone={report.bookings.cancelled ? "danger" : "default"} />
          <StatTile label="Active agreement" value={formatINR(report.bookings.agreementValue, true)} />
          <StatTile label={`Collected · ${days}d`} value={formatINR(report.bookings.collected, true)} tone="good" />
          <StatTile label={`Refunds · ${days}d`} value={formatINR(report.bookings.refunded, true)} tone={report.bookings.refunded ? "danger" : "default"} />
          <StatTile label="Outstanding now" value={formatINR(report.bookings.outstanding, true)} tone="warn" />
        </div>
      </section>

      {/* Every figure above is what the register claims. This section is the
          subset a second pair of eyes has checked against the bank — kept
          apart rather than folded in, because a revenue number nobody has
          verified and one that finance has signed off are not the same claim
          and should never be totalled together. */}
      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Validated transactions</h2>
            <p className="text-xs text-zinc-500">
              Booking amounts accounts has matched against the bank, separated from the rest.
            </p>
          </div>
          {can(user, "accounts:read") && (
            <Link href="/accounts" className="text-sm font-medium text-brand-600 hover:underline">
              Open verification queue
            </Link>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatTile
            label="Validated bookings"
            value={formatNumber(verification.validated)}
            hint={`${formatPercent(verifiedShare, 0)} of live bookings`}
            tone="good"
          />
          <StatTile
            label="Validated value"
            value={formatINR(verification.validatedValue, true)}
            hint="Confirmed against the bank"
            tone="good"
          />
          <StatTile
            label="Awaiting verification"
            value={formatNumber(verification.pending)}
            hint={formatINR(verification.pendingValue, true)}
            tone={verification.pending ? "warn" : "default"}
          />
          <StatTile
            label="No match"
            value={formatNumber(verification.noMatch)}
            hint={formatINR(verification.noMatchValue, true)}
            tone={verification.noMatch ? "danger" : "default"}
          />
          <StatTile
            label="Re-check needed"
            value={formatNumber(verification.drifted)}
            hint={`${formatINR(verification.driftedValue, true)} received since sign-off`}
            tone={verification.drifted ? "warn" : "default"}
          />
        </div>
      </section>

      <Card
        title="Verification coverage"
        subtitle="Booked value per period, split by whether accounts has confirmed it. The line is the verified share — a taller column with the same ratio is more money nobody has checked."
      >
        <div className="px-3 pb-4 pt-2 sm:px-5">
          <VerificationChart data={verificationTrend} />
        </div>
      </Card>

      <Card
        title={`${validatedTransactions.length} validated in the last ${days} days`}
        subtitle="Each row is a decision by a named person against a named amount."
      >
        {validatedTransactions.length === 0 ? (
          <EmptyState
            title="No validated transactions in this period"
            hint="Bookings are validated from the Accounts queue once the receipt is traced in the bank."
          />
        ) : (
          <DataTable>
            <thead className="border-b border-zinc-100 dark:border-zinc-800">
              <tr>
                <Th>Booking</Th>
                <Th>Buyer</Th>
                <Th>Project / unit</Th>
                <Th className="text-right">Agreement</Th>
                <Th className="text-right">Validated amount</Th>
                <Th>Validated by</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {validatedTransactions.map((row) => (
                <tr key={row.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <Td>
                    <Link
                      href={`/bookings/${row.id}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      {row.reference}
                    </Link>
                    <div className="mt-1"><BookingStatusBadge status={row.status} /></div>
                  </Td>
                  <Td>{row.personName ?? "Unnamed"}</Td>
                  <Td>
                    <p>{row.projectName ?? "—"}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">{row.unitLabel ?? "—"}</p>
                  </Td>
                  <Td className="tabular text-right">{formatINR(row.agreementValue, true)}</Td>
                  <Td className="tabular text-right font-medium text-emerald-700 dark:text-emerald-400">
                    {formatINR(row.verifiedAmount, true)}
                  </Td>
                  <Td className="whitespace-nowrap text-zinc-500">
                    {row.verifiedByName ?? "—"}
                    <span className="block text-xs">{formatDateTime(row.verifiedAt)}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-[420px_1fr]">
        <Card title="Ground-truth funnel" subtitle={`Lead cohort created in the last ${days} days.`}>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {funnelRows.map((row, index) => {
              const prior = index > 0 ? funnelRows[index - 1]?.value ?? 0 : 0;
              return (
                <div key={row.label} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div>
                    <p className="text-sm font-medium">{row.label}</p>
                    {index > 0 && (
                      <p className="text-xs text-zinc-500">
                        {prior > 0 ? formatPercent(row.value / prior, 1) : "—"} from prior fact
                      </p>
                    )}
                  </div>
                  <p className="tabular text-lg font-semibold">{formatNumber(row.value)}</p>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Sales-agent outcomes" subtitle="Visits use actual arrivals; revenue uses the snapshotted booking closer.">
          {report.agents.length === 0 ? (
            <EmptyState title="No active sales users" />
          ) : (
            <DataTable>
              <thead className="border-b border-zinc-100 dark:border-zinc-800">
                <tr>
                  <Th>Agent</Th>
                  <Th className="text-right">Leads</Th>
                  <Th className="text-right">Visits</Th>
                  <Th className="text-right">Bookings</Th>
                  <Th className="text-right">Agreement</Th>
                  <Th className="text-right">Collections</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {report.agents.map((agent) => (
                  <tr key={agent.id}>
                    <Td className="font-medium">{agent.name}</Td>
                    <Td className="tabular text-right">{formatNumber(agent.leads)}</Td>
                    <Td className="tabular text-right">{formatNumber(agent.visits)}</Td>
                    <Td className="tabular text-right font-medium">{formatNumber(agent.bookings)}</Td>
                    <Td className="tabular text-right">{formatINR(agent.agreementValue, true)}</Td>
                    <Td className="tabular text-right">{formatINR(agent.collections, true)}</Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Card>
      </div>

      <Card
        title="Campaign outcomes"
        subtitle={projectId ? "Project-scoped outcomes. Spend is omitted because the current spend feed has no project key." : "First-touch campaign joined to visits, bookings, payments, and synced ad spend."}
      >
        {report.campaigns.length === 0 ? (
          <EmptyState title="No attributed campaign outcomes" hint="Campaign IDs must be captured on first touch." />
        ) : (
          <DataTable>
            <thead className="border-b border-zinc-100 dark:border-zinc-800">
              <tr>
                <Th>Campaign</Th>
                <Th className="text-right">Spend</Th>
                <Th className="text-right">Leads</Th>
                <Th className="text-right">Qualified</Th>
                <Th className="text-right">Visits</Th>
                <Th className="text-right">Bookings</Th>
                <Th className="text-right">Agreement</Th>
                <Th className="text-right">Collections</Th>
                <Th className="text-right">Cost / booking</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {report.campaigns.map((campaign) => (
                <tr key={`${campaign.platform}-${campaign.campaignId}`}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <SourceBadge source={campaign.platform ?? "unknown"} platform={campaign.platform} />
                      <span className="max-w-[220px] truncate font-medium">
                        {campaign.campaignName ?? campaign.campaignId}
                      </span>
                    </div>
                  </Td>
                  <Td className="tabular text-right">{formatINR(campaign.spend, true)}</Td>
                  <Td className="tabular text-right">{formatNumber(campaign.leads)}</Td>
                  <Td className="tabular text-right">{formatNumber(campaign.qualified)}</Td>
                  <Td className="tabular text-right">{formatNumber(campaign.visits)}</Td>
                  <Td className="tabular text-right font-medium">{formatNumber(campaign.bookings)}</Td>
                  <Td className="tabular text-right">{formatINR(campaign.agreementValue, true)}</Td>
                  <Td className="tabular text-right">{formatINR(campaign.collections, true)}</Td>
                  <Td className="tabular text-right font-medium">
                    {campaign.spend > 0 && campaign.bookings > 0
                      ? formatINR(campaign.spend / campaign.bookings, true)
                      : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>

      <Card title="Creative outcomes" subtitle="First-touch creative; no stage-only booking inference.">
        {report.creatives.length === 0 ? (
          <EmptyState title="No creative-level attribution yet" />
        ) : (
          <DataTable>
            <thead className="border-b border-zinc-100 dark:border-zinc-800">
              <tr>
                <Th>Creative</Th>
                <Th>Campaign</Th>
                <Th className="text-right">Leads</Th>
                <Th className="text-right">Visits</Th>
                <Th className="text-right">Bookings</Th>
                <Th className="text-right">Agreement</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {report.creatives.map((creative) => (
                <tr key={`${creative.platform}-${creative.creativeId}`}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <SourceBadge source={creative.platform ?? "unknown"} platform={creative.platform} />
                      <span className="max-w-[220px] truncate font-medium">
                        {creative.creativeName ?? creative.creativeId}
                      </span>
                    </div>
                  </Td>
                  <Td className="max-w-[220px] truncate">{creative.campaignName ?? "—"}</Td>
                  <Td className="tabular text-right">{formatNumber(creative.leads)}</Td>
                  <Td className="tabular text-right">{formatNumber(creative.visits)}</Td>
                  <Td className="tabular text-right font-medium">{formatNumber(creative.bookings)}</Td>
                  <Td className="tabular text-right">{formatINR(creative.agreementValue, true)}</Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>

      <Card
        title="Cash movement"
        subtitle={
          refundedTotal > 0
            ? "Collections above the line, refunds below it. The net line dips through zero when a period gave back more than it took."
            : "Collections across the period. Refunds would appear below the line — there have been none."
        }
      >
        <div className="px-3 pb-4 pt-2 sm:px-5">
          <CashMovementChart data={cashMovement} />
        </div>
      </Card>

      <Card
        title="Walk-in channels"
        subtitle="Public link performance, carried from the QR or WhatsApp forward all the way to agreement value."
        action={
          <Link href="/walk-ins/links" className="text-sm font-medium text-brand-600 hover:underline">
            Manage links
          </Link>
        }
      >
        {channels.length === 0 ? (
          <EmptyState
            title="No channel links yet"
            hint="Create a passcode-gated walk-in link per broker or site to tell these channels apart."
          />
        ) : (
          <DataTable>
            <thead className="border-b border-zinc-100 dark:border-zinc-800">
              <tr>
                <Th>Channel</Th>
                <Th>Type</Th>
                <Th className="text-right">Opens</Th>
                <Th className="text-right">Check-ins</Th>
                <Th className="text-right">Leads</Th>
                <Th className="text-right">Site visits</Th>
                <Th className="text-right">Bookings</Th>
                <Th className="text-right">Agreement</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {channels.map((channel) => (
                <tr key={channel.id}>
                  <Td>
                    <p className="font-medium">{channel.label}</p>
                    <p className="text-xs text-zinc-500">
                      {channel.contactName ?? "—"}
                      {channel.projectName ? ` · ${channel.projectName}` : ""}
                      {channel.isActive ? "" : " · paused"}
                    </p>
                  </Td>
                  <Td className="text-zinc-600 dark:text-zinc-400">
                    {WALK_IN_LINK_TYPE_LABELS[channel.linkType]}
                  </Td>
                  <Td className="tabular text-right">{formatNumber(channel.viewCount)}</Td>
                  <Td className="tabular text-right">{formatNumber(channel.submissionCount)}</Td>
                  <Td className="tabular text-right">{formatNumber(channel.leadCount)}</Td>
                  <Td className="tabular text-right">{formatNumber(channel.siteVisitCount)}</Td>
                  <Td className="tabular text-right font-medium">{formatNumber(channel.bookedCount)}</Td>
                  <Td className="tabular text-right">{formatINR(channel.bookedValue, true)}</Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>

      <p className="text-xs text-zinc-500">
        Booking totals elsewhere on this page are what the register recorded; the validated figures
        are the subset accounts has separately confirmed, and the two are never added together.
        Funnel stages are a history ledger, but visits, bookings, and collections are counted only
        from their operational tables. This keeps commercial reports intact even when salespeople
        skip or manually correct a stage. Channel figures ignore the date filter — a link is judged
        over its whole life, not a rolling window.
      </p>
    </div>
  );
}
