import { LEAD_STAGES } from "@monark/core";
import { can, requirePermission } from "@/lib/auth";
import { getPipeline } from "@/lib/queries";
import { canViewSalesTeam, listSalesOwners, resolveSalesOwnerFilter } from "@/lib/sales-queries";
import { PipelineBoard, type PipelineCard } from "@/components/pipeline-board";
import { formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Pipeline board.
 *
 * Cards drag between columns, but a drag on its own only records that a lead
 * moved — not why. The "why" is what the funnel analysis needs, so a backwards
 * move stops and asks for a reason before it commits, and the four stages
 * backed by real-world evidence (visit scheduled, visited, token paid, booked)
 * refuse the drop entirely: those belong to the workflows that can prove they
 * happened, because each one also reports a conversion to Meta and Google.
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

  const cards: PipelineCard[] = leads.map((lead) => ({
    id: lead.id,
    stage: lead.stage,
    name: lead.fullName ?? lead.reference,
    primaryPhone: lead.primaryPhone,
    ownerName: lead.ownerName,
    attributionExpiresAt: lead.attributionExpiresAt,
    nextFollowUpAt: lead.nextFollowUpAt,
  }));

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

      <PipelineBoard
        stages={LEAD_STAGES}
        cards={cards}
        canWrite={can(user, "leads:write")}
      />
    </div>
  );
}
