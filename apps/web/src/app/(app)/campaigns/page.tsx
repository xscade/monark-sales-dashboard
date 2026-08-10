import { requirePermission } from "@/lib/auth";
import { getCampaignPerformance } from "@/lib/queries";
import { Card, DataTable, EmptyState, SourceBadge, Td, Th } from "@/components/ui";
import { formatINR, formatNumber, formatPercent } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Campaign intelligence.
 *
 * The point of this table is the right-hand columns. Cost per lead is the
 * metric Ads Manager shows by default, and it systematically rewards whichever
 * campaign produces the most cheap, worthless form fills. Carrying spend
 * through to site visits and bookings routinely inverts the ranking — the
 * "expensive" campaign is often several times more profitable.
 */
export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const user = await requirePermission("campaigns:read");
  const params = await searchParams;
  const days = Number(params.days ?? 90) || 90;

  const rows = await getCampaignPerformance(user.orgId, days);

  const totals = rows.reduce(
    (acc, r) => ({
      spend: acc.spend + r.spend,
      leads: acc.leads + r.leads,
      qualified: acc.qualified + r.qualified,
      visits: acc.visits + r.visits,
      bookings: acc.bookings + r.bookings,
    }),
    { spend: 0, leads: 0, qualified: 0, visits: 0, bookings: 0 },
  );

  const perOrDash = (spend: number, count: number) =>
    count > 0 && spend > 0 ? formatINR(spend / count, true) : "—";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Campaign intelligence</h1>
          <p className="mt-0.5 text-sm text-zinc-500">Spend joined to real outcomes, last {days} days</p>
        </div>
        <form method="get">
          <select
            name="days"
            defaultValue={String(days)}
            className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="180">180 days</option>
            <option value="365">365 days</option>
          </select>
          <button
            type="submit"
            className="ml-2 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Apply
          </button>
        </form>
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No campaign data yet"
            hint="Leads need a campaign_id captured at ingestion, and ad spend must be synced into ad_spend_daily. Until spend is present this table can only show volumes, not cost."
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Tile label="Spend" value={formatINR(totals.spend, true)} />
            <Tile label="Leads" value={formatNumber(totals.leads)} sub={perOrDash(totals.spend, totals.leads)} />
            <Tile label="Qualified" value={formatNumber(totals.qualified)} sub={perOrDash(totals.spend, totals.qualified)} />
            <Tile label="Site visits" value={formatNumber(totals.visits)} sub={perOrDash(totals.spend, totals.visits)} />
            <Tile label="Bookings" value={formatNumber(totals.bookings)} sub={perOrDash(totals.spend, totals.bookings)} />
          </div>

          <Card
            title="By campaign"
            subtitle="Sorted by spend. Compare cost per booking, not cost per lead."
          >
            <DataTable>
              <thead className="border-b border-zinc-100 dark:border-zinc-800">
                <tr>
                  <Th>Campaign</Th>
                  <Th className="text-right">Spend</Th>
                  <Th className="text-right">Leads</Th>
                  <Th className="text-right">Qual.</Th>
                  <Th className="text-right">Visits</Th>
                  <Th className="text-right">Booked</Th>
                  <Th className="text-right">Cost / lead</Th>
                  <Th className="text-right">Cost / visit</Th>
                  <Th className="text-right">Cost / booking</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {rows.map((r) => (
                  <tr key={`${r.platform}-${r.campaignId}`} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <Td>
                      <div className="flex items-center gap-2">
                        <SourceBadge source={r.platform ?? "unknown"} platform={r.platform} />
                        <span className="max-w-[220px] truncate font-medium">
                          {r.campaignName ?? r.campaignId}
                        </span>
                      </div>
                    </Td>
                    <Td className="tabular text-right">{formatINR(r.spend, true)}</Td>
                    <Td className="tabular text-right">{formatNumber(r.leads)}</Td>
                    <Td className="tabular text-right">
                      {formatNumber(r.qualified)}
                      {r.leads > 0 && (
                        <span className="ml-1 text-xs text-zinc-500">
                          {formatPercent(r.qualified / r.leads, 0)}
                        </span>
                      )}
                    </Td>
                    <Td className="tabular text-right">{formatNumber(r.visits)}</Td>
                    <Td className="tabular text-right font-medium">{formatNumber(r.bookings)}</Td>
                    <Td className="tabular text-right text-zinc-500">{perOrDash(r.spend, r.leads)}</Td>
                    <Td className="tabular text-right">{perOrDash(r.spend, r.visits)}</Td>
                    <Td className="tabular text-right font-medium">{perOrDash(r.spend, r.bookings)}</Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </Card>

          <p className="text-xs text-zinc-500">
            Bookings are under-counted by design: Google stops attributing 90 days after the click,
            and a meaningful share of ₹2.5–4 Cr sales close after that. Treat cost per booking as a
            floor on true performance, and optimise campaigns on site visits instead.
          </p>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="tabular mt-1.5 text-xl font-semibold">{value}</p>
      {sub && <p className="tabular mt-0.5 text-xs text-zinc-500">{sub} each</p>}
    </div>
  );
}
