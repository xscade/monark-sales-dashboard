import Link from "next/link";
import { can, requirePermission } from "@/lib/auth";
import { listLeads, listAgents, type LeadFilters } from "@/lib/queries";
import { AttributionClock, Card, DataTable, EmptyState, SourceBadge, StageBadge, Td, Th } from "@/components/ui";
import { formatDuration, formatNumber, formatRelative, maskPhoneDisplay } from "@/lib/format";
import { LEAD_STAGES, TERMINAL_STAGES } from "@monark/core";
import { stageLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { canViewSalesTeam, resolveSalesOwnerFilter } from "@/lib/sales-queries";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; owner?: string; q?: string; page?: string }>;
}) {
  const user = await requirePermission("leads:read");
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const teamView = canViewSalesTeam(user.role);
  const ownerId = resolveSalesOwnerFilter(user.role, user.id, params.owner);

  const filters: LeadFilters = {
    stage: params.stage,
    ownerId,
    search: params.q,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const [rows, agents] = await Promise.all([
    listLeads(user.orgId, filters),
    teamView ? listAgents(user.orgId) : Promise.resolve([]),
  ]);

  const total = rows[0]?.totalCount ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const buildHref = (overrides: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { stage: params.stage, owner: params.owner, q: params.q, page: undefined, ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
    const qs = next.toString();
    return qs ? `/leads?${qs}` : "/leads";
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mt-0.5 text-sm text-zinc-500">{formatNumber(total)} matching</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
        {can(user, "leads:write") && <Button asChild size="sm"><Link href="/walk-ins/new"><Plus />Add lead</Link></Button>}
        <form method="get" className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Phone, name, or LD-reference"
            className="w-56 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <select
            name="stage"
            defaultValue={params.stage ?? ""}
            className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">All stages</option>
            {[...LEAD_STAGES, ...TERMINAL_STAGES].map((s) => (
              <option key={s} value={s}>
                {stageLabel(s)}
              </option>
            ))}
          </select>
          {teamView && <select
            name="owner"
            defaultValue={ownerId ?? ""}
            className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">All owners</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>}
          <button
            type="submit"
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            Filter
          </button>
        </form>
        </div>
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title="No leads match"
            hint="Try clearing filters, or check that your website is posting to POST /v1/leads."
          />
        ) : (
          <DataTable>
            <thead className="border-b border-zinc-100 dark:border-zinc-800">
              <tr>
                <Th>Lead</Th>
                <Th>Stage</Th>
                <Th>Source</Th>
                <Th>Owner</Th>
                <Th className="text-right">Response</Th>
                <Th>Attribution</Th>
                <Th className="text-right">Created</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.map((lead) => (
                <tr key={lead.id} className="transition hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <Td>
                    <Link href={`/leads/${lead.id}`} className="block">
                      <p className="font-medium">{lead.fullName ?? "Unnamed"}</p>
                      <p className="tabular text-xs text-zinc-500">
                        {maskPhoneDisplay(lead.primaryPhone)} · {lead.reference}
                      </p>
                    </Link>
                  </Td>
                  <Td>
                    <StageBadge stage={lead.stage} />
                  </Td>
                  <Td>
                    <SourceBadge source={lead.source ?? "unknown"} platform={lead.adPlatform} />
                    {lead.campaignName && (
                      <p className="mt-0.5 max-w-[180px] truncate text-xs text-zinc-500">
                        {lead.campaignName}
                      </p>
                    )}
                  </Td>
                  <Td className="text-zinc-600 dark:text-zinc-400">{lead.ownerName ?? "Unassigned"}</Td>
                  <Td
                    className={`tabular text-right ${
                      (lead.firstResponseSeconds ?? 0) > 3600 ? "text-amber-600 dark:text-amber-400" : ""
                    }`}
                  >
                    {formatDuration(lead.firstResponseSeconds)}
                  </Td>
                  <Td>
                    <AttributionClock expiresAt={lead.attributionExpiresAt} />
                  </Td>
                  <Td className="text-right text-xs text-zinc-500">
                    {formatRelative(lead.createdAt)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-500">
            Page {page} of {pages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={buildHref({ page: String(page - 1) })}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Previous
              </Link>
            )}
            {page < pages && (
              <Link
                href={buildHref({ page: String(page + 1) })}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
