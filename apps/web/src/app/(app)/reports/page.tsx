import Link from "next/link";
import { Card, DataTable, EmptyState, SourceBadge, StatTile, Td, Th } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { getCommercialReports, listCommercialProjects } from "@/lib/commercial-queries";
import { formatINR, formatNumber, formatPercent } from "@/lib/format";

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
  const [projects, report] = await Promise.all([
    listCommercialProjects(user.orgId),
    getCommercialReports(user.orgId, { days, projectId }),
  ]);

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
          <h1 className="text-xl font-semibold">Commercial reports</h1>
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

      <p className="text-xs text-zinc-500">
        Funnel stages are a history ledger, but visits, bookings, and collections are counted only
        from their operational tables. This keeps commercial reports intact even when salespeople
        skip or manually correct a stage.
      </p>
    </div>
  );
}
