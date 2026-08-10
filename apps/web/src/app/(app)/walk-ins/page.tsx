import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { searchForCheckIn } from "@/lib/queries";
import { checkInVisit } from "@/lib/actions";
import { Card, EmptyState, SourceBadge, StageBadge, SubmitButton } from "@/components/ui";
import { formatRelative } from "@/lib/format";

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
  const user = await requireUser();
  const params = await searchParams;
  const query = params.q?.trim() ?? "";

  const results = query ? await searchForCheckIn(user.orgId, query) : [];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Walk-in check-in</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Search by phone number, then check the visitor in.
        </p>
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
            hint="This may be a fresh walk-in with no prior enquiry. Capture their details through the website form or add them manually, then check in."
          />
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

          <form action={checkInVisit} className="space-y-3 p-5">
            <input type="hidden" name="leadId" value={lead.id} />
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

            <div className="flex items-center gap-3">
              <SubmitButton className="px-5 py-2.5">Check in now</SubmitButton>
              <p className="text-xs text-zinc-500">
                Records the arrival and queues a site-visit conversion for Meta and Google.
              </p>
            </div>
          </form>
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
