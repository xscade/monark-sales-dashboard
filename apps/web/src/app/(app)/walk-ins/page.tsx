import Link from "next/link";
import { randomUUID } from "node:crypto";
import { can, requirePermission } from "@/lib/auth";
import { searchForCheckIn } from "@/lib/queries";
import { checkInVisit } from "@/lib/actions";
import { Card, EmptyState, SourceBadge, StageBadge, SubmitButton } from "@/components/ui";
import { formatRelative } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Link2, Plus } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Walk-in desk.
 *
 * Optimised for one situation: a buyer is standing at the counter and someone
 * has thirty seconds to record it before the conversation starts. Search by
 * phone, confirm the person, tap check in.
 *
 * This screen is where the platform's most valuable signal is created. A site
 * visit is the strongest mid-funnel evidence Monark has, it happens reliably
 * inside Google's 90-day window, and it exists nowhere else — no pixel can
 * observe someone walking through a door.
 */
export default async function WalkInsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requirePermission("visits:read");
  const writable = can(user, "visits:write");
  const params = await searchParams;
  const query = params.q?.trim() ?? "";

  // Individual contributors may only check in opportunities they own. Keep
  // the lookup aligned with the mutation guard so the UI never exposes a
  // teammate's buyer and then offers an action that must fail.
  const results = query
    ? await searchForCheckIn(
        user.orgId,
        query,
        user.role === "sales_agent" ? user.id : undefined,
      )
    : [];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Reception desk</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Walk-in check-in</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Search existing customers or capture a first-time visitor.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can(user, "settings:write") && (
            <Button asChild variant="outline"><Link href="/walk-ins/links"><Link2 />Channel links</Link></Button>
          )}
          {writable && <Button asChild><Link href="/walk-ins/new"><Plus />New walk-in</Link></Button>}
        </div>
      </div>

      <form method="get">
        <input
          type="search"
          name="q"
          defaultValue={query}
          autoFocus
          inputMode="tel"
          placeholder="9876543210"
          // Deliberately large: this gets tapped on a phone at a site office,
          // often one-handed.
          className="tabular w-full rounded-xl border border-zinc-300 bg-white px-4 py-4 text-lg outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-brand-700/30"
        />
      </form>

      {query && results.length === 0 && (
        <Card>
          <EmptyState
            title="No matching lead"
            hint="This may be a first-time visitor. Use New walk-in to capture and check them in together."
          />
          {writable && <div className="flex justify-center pb-6"><Button asChild><Link href="/walk-ins/new"><Plus />Capture visitor</Link></Button></div>}
        </Card>
      )}

      {results.map((lead) => (
        <Card key={lead.id}>
          <div className="border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link href={`/leads/${lead.id}`} className="text-base font-semibold hover:underline">
                  {lead.fullName ?? "Unnamed"}
                </Link>
                <p className="tabular mt-0.5 text-sm text-zinc-500">
                  {lead.primaryPhone} · {lead.reference}
                </p>
              </div>
              <StageBadge stage={lead.stage} />
            </div>

            {/* Context the salesperson can open with — knowing the buyer came
                from a testimonial video is worth more than any CRM field. */}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <SourceBadge source="lead" platform={lead.adPlatform} />
              {lead.campaignName && <span>{lead.campaignName}</span>}
              {lead.creativeName && <span>· {lead.creativeName}</span>}
              <span>· enquired {formatRelative(lead.createdAt)}</span>
              {lead.ownerName && <span>· owner {lead.ownerName}</span>}
            </div>
          </div>

          {writable && lead.projectId && <form action={checkInVisit} className="space-y-3 p-5">
            <input type="hidden" name="leadId" value={lead.id} />
            <input type="hidden" name="visitId" value={randomUUID()} />
            <input type="hidden" name="checkInMethod" value="manual" />

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">Location</span>
                <select
                  name="visitType"
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                >
                  <option value="corporate_office">Corporate office</option>
                  <option value="project_site">Project site</option>
                  <option value="experience_centre">Experience centre</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">People with them</span>
                <input
                  name="accompanyingCount"
                  type="number"
                  min={0}
                  max={20}
                  defaultValue={0}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">Intent</span>
                <select
                  name="intentRating"
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                >
                  <option value="">Not rated</option>
                  <option value="5">Very high</option>
                  <option value="4">High</option>
                  <option value="3">Medium</option>
                  <option value="2">Low</option>
                  <option value="1">Just looking</option>
                </select>
              </label>
            </div>

            <textarea
              name="notes"
              rows={2}
              placeholder="Configuration discussed, objections, next step…"
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">Configurations shown</span>
                <input name="configurationsViewed" placeholder="3 BHK, 4 BHK" className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">Next action</span>
                <input name="nextAction" placeholder="Site visit, proposal, follow-up" className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" />
              </label>
            </div>

            <div className="flex items-center gap-3">
              <SubmitButton className="px-5 py-2.5">Check in now</SubmitButton>
              <p className="text-xs text-zinc-500">
                Records the arrival and queues a site-visit conversion for Meta and Google.
              </p>
            </div>
          </form>}
          {writable && !lead.projectId && (
            <div className="flex flex-wrap items-center justify-between gap-3 p-5">
              <p className="text-sm text-muted-foreground">Assign a project before recording the visit so attribution reaches the correct destination.</p>
              <Button asChild variant="outline"><Link href={`/leads/${lead.id}`}>Assign project</Link></Button>
            </div>
          )}
        </Card>
      ))}

      {!query && (
        <Card>
          <EmptyState
            title="Start by searching a phone number"
            hint="Family members often share a number, so confirm the name before checking in."
          />
        </Card>
      )}
    </div>
  );
}
