import Link from "next/link";
import { requireUser, can } from "@/lib/auth";
import {
  getAgentPerformance,
  getExpiringAttribution,
  getFunnel,
  getOverviewStats,
} from "@/lib/queries";
import { Card, DataTable, EmptyState, StatTile, StageBadge, Td, Th } from "@/components/ui";
import { formatDuration, formatNumber, formatPercent, formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const user = await requireUser();

  const [stats, funnel, expiring, agents] = await Promise.all([
    getOverviewStats(user.orgId),
    getFunnel(user.orgId),
    getExpiringAttribution(user.orgId),
    can(user, "campaigns:read") ? getAgentPerformance(user.orgId) : Promise.resolve([]),
  ]);

  const top = funnel[0]?.leads ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Overview</h1>
        <p className="mt-0.5 text-sm text-zinc-500">Last 90 days unless noted</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Leads today" value={formatNumber(stats.leadsToday ?? 0)} />
        <StatTile
          label="Unworked"
          value={formatNumber(stats.unworked ?? 0)}
          hint="Still in New"
          tone={(stats.unworked ?? 0) > 0 ? "warn" : "default"}
          href="/leads?stage=new"
        />
        <StatTile
          label="Untouched > 24h"
          value={formatNumber(stats.untouched24h ?? 0)}
          hint="Speed-to-lead breach"
          tone={(stats.untouched24h ?? 0) > 0 ? "danger" : "good"}
          href="/leads?stage=new"
        />
        <StatTile
          label="Avg first response"
          value={formatDuration(stats.medianResponseSeconds ?? 0)}
          hint="Last 30 days"
          tone={(stats.medianResponseSeconds ?? 0) > 3600 ? "warn" : "good"}
        />
        <StatTile label="Overdue follow-ups" value={formatNumber(stats.overdue ?? 0)} tone={(stats.overdue ?? 0) > 0 ? "warn" : "default"} />
        <StatTile label="Visits scheduled today" value={formatNumber(stats.visitsToday ?? 0)} href="/walk-ins" />
        <StatTile label="Visits (30d)" value={formatNumber(stats.visits30d ?? 0)} />
        <StatTile label="Bookings (30d)" value={formatNumber(stats.bookings30d ?? 0)} tone="good" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title="Funnel"
          subtitle="Leads that ever reached each stage — not those currently sitting in it"
        >
          {top === 0 ? (
            <EmptyState
              title="No leads yet"
              hint="Once the website starts posting to /v1/leads, the funnel fills in here."
            />
          ) : (
            <div className="space-y-2 p-5">
              {funnel.map((row) => {
                const pct = top > 0 ? row.leads / top : 0;
                return (
                  <div key={row.stage} className="flex items-center gap-3">
                    <div className="w-32 shrink-0">
                      <StageBadge stage={row.stage} />
                    </div>
                    <div className="h-7 flex-1 overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className="h-full rounded-md bg-brand-500/80"
                        style={{ width: `${Math.max(pct * 100, row.leads > 0 ? 2 : 0)}%` }}
                      />
                    </div>
                    <div className="tabular w-24 shrink-0 text-right text-sm">
                      <span className="font-medium">{formatNumber(row.leads)}</span>
                      <span className="ml-1.5 text-xs text-zinc-500">{formatPercent(pct, 0)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card
          title="Attribution closing"
          subtitle="Google stops attributing 90 days after the click"
        >
          {expiring.length === 0 ? (
            <EmptyState title="Nothing closing soon" />
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {expiring.map((lead) => {
                const days = Math.floor(
                  (new Date(lead.expiresAt).getTime() - Date.now()) / 86_400_000,
                );
                return (
                  <li key={lead.id}>
                    <Link
                      href={`/leads/${lead.id}`}
                      className="flex items-center justify-between gap-3 px-5 py-2.5 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{lead.fullName ?? lead.reference}</p>
                        <p className="truncate text-xs text-zinc-500">
                          {lead.campaignName ?? "—"}
                        </p>
                      </div>
                      <span
                        className={`tabular shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${
                          days <= 7
                            ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                            : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                        }`}
                      >
                        {days}d
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {agents.length > 0 && (
        <Card title="Sales performance" subtitle="Last 30 days">
          <DataTable>
            <thead className="border-b border-zinc-100 dark:border-zinc-800">
              <tr>
                <Th>Agent</Th>
                <Th className="text-right">Leads</Th>
                <Th className="text-right">Contacted</Th>
                <Th className="text-right">Visits</Th>
                <Th className="text-right">Bookings</Th>
                <Th className="text-right">Avg response</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {agents.map((a) => (
                <tr key={a.id}>
                  <Td className="font-medium">{a.name}</Td>
                  <Td className="tabular text-right">{formatNumber(a.leads)}</Td>
                  <Td className="tabular text-right">
                    {formatNumber(a.contacted)}
                    <span className="ml-1 text-xs text-zinc-500">
                      {a.leads > 0 ? formatPercent(a.contacted / a.leads, 0) : ""}
                    </span>
                  </Td>
                  <Td className="tabular text-right">{formatNumber(a.visits)}</Td>
                  <Td className="tabular text-right font-medium">{formatNumber(a.bookings)}</Td>
                  <Td
                    className={`tabular text-right ${
                      a.avgResponseSeconds > 3600 ? "text-amber-600 dark:text-amber-400" : ""
                    }`}
                  >
                    {formatDuration(a.avgResponseSeconds)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Card>
      )}
    </div>
  );
}
