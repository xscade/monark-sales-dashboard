import Link from "next/link";
import { LEAD_STAGES } from "@monark/core";
import { requirePermission } from "@/lib/auth";
import { getPipeline } from "@/lib/queries";
import { canViewSalesTeam, listSalesOwners, resolveSalesOwnerFilter } from "@/lib/sales-queries";
import { AttributionClock } from "@/components/ui";
import { formatNumber, formatRelative, maskPhoneDisplay, stageLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Pipeline board.
 *
 * Read-only columns rather than drag-and-drop. Stage changes go through the
 * lead page, where a reason can be captured — and a reason is exactly what
 * makes a regression meaningful later. A drag gesture records the move but
 * loses the "why", and the "why" is what the funnel analysis needs.
 */
export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ owner?: string }>;
}) {
  const user = await requirePermission("leads:read");
  const params = await searchParams;

  // Agents default to their own board — a shared list of 400 leads is not a
  // work queue, it is wallpaper.
  const teamView = canViewSalesTeam(user.role);
  const ownerFilter = resolveSalesOwnerFilter(user.role, user.id, params.owner);

  const [leads, agents] = await Promise.all([
    getPipeline(user.orgId, ownerFilter),
    teamView ? listSalesOwners(user.orgId) : Promise.resolve([]),
  ]);

  const byStage = new Map<string, typeof leads>();
  for (const stage of LEAD_STAGES) byStage.set(stage, []);
  for (const lead of leads) byStage.get(lead.stage)?.push(lead);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Pipeline</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            {formatNumber(leads.length)} open leads
          </p>
        </div>
        {teamView && <form method="get">
          <select
            name="owner"
            defaultValue={ownerFilter ?? ""}
            onChange={undefined}
            className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">Everyone</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="ml-2 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Apply
          </button>
        </form>}
      </div>

      <div className="flex gap-3 overflow-x-auto pb-4">
        {LEAD_STAGES.map((stage) => {
          const column = byStage.get(stage) ?? [];
          return (
            <div key={stage} className="w-72 shrink-0">
              <div className="mb-2 flex items-center justify-between px-1">
                <h2 className="text-sm font-medium">{stageLabel(stage)}</h2>
                <span className="tabular rounded-md bg-zinc-200 px-1.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                  {column.length}
                </span>
              </div>

              <div className="space-y-2">
                {column.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-6 text-center text-xs text-zinc-400 dark:border-zinc-800">
                    Empty
                  </p>
                ) : (
                  column.slice(0, 50).map((lead) => (
                    <Link
                      key={lead.id}
                      href={`/leads/${lead.id}`}
                      className="block rounded-lg border border-zinc-200 bg-white p-3 transition hover:border-brand-400 dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <p className="truncate text-sm font-medium">{lead.fullName ?? lead.reference}</p>
                      <p className="tabular mt-0.5 truncate text-xs text-zinc-500">
                        {maskPhoneDisplay(lead.primaryPhone)}
                      </p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-zinc-500">
                          {lead.ownerName ?? "Unassigned"}
                        </span>
                        <AttributionClock expiresAt={lead.attributionExpiresAt} />
                      </div>
                      {lead.nextFollowUpAt && (
                        <p
                          className={`mt-1.5 text-xs ${
                            new Date(lead.nextFollowUpAt) < new Date()
                              ? "text-red-600 dark:text-red-400"
                              : "text-zinc-500"
                          }`}
                        >
                          Follow up {formatRelative(lead.nextFollowUpAt)}
                        </p>
                      )}
                    </Link>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
