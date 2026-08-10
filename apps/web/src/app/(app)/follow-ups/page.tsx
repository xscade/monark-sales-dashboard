import Link from "next/link";
import { AlarmClock, CalendarPlus, Check, Phone } from "lucide-react";
import { can, requirePermission } from "@/lib/auth";
import { completeTask, rescheduleTask } from "@/lib/sales-actions";
import { getFollowUpCounts, listFollowUps } from "@/lib/follow-up-queries";
import {
  FOLLOW_UP_CHANNEL_LABELS,
  FOLLOW_UP_SCOPES,
  FOLLOW_UP_SCOPE_LABELS,
  isFollowUpChannel,
  normalizeFollowUpScope,
  parseFollowUpSorts,
} from "@/lib/follow-ups";
import { canViewSalesTeam, listSalesOwners, resolveSalesOwnerFilter } from "@/lib/sales-queries";
import { FollowUpSortControls } from "@/components/follow-up-sort-controls";
import { Card, EmptyState, StageBadge, SubmitButton } from "@/components/ui";
import { formatDateTime, formatNumber, formatRelative, maskPhoneDisplay } from "@/lib/format";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * Follow-ups.
 *
 * The same rows as Tasks, asked a different question. Tasks answers "what is on
 * my list"; this answers "who is going cold, and in what order do I call them".
 * That is why the sort is multi-key and why the `missing` scope exists — a lead
 * with no next step at all never appears on a task list precisely because there
 * is no task, which is exactly when it needs attention.
 */
export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<{
    owner?: string;
    scope?: string;
    sort?: string;
    q?: string;
    page?: string;
    from?: string;
    notice?: string;
    error?: string;
  }>;
}) {
  const user = await requirePermission("tasks:read");
  const params = await searchParams;
  const scope = normalizeFollowUpScope(params.scope);
  const sorts = parseFollowUpSorts(params.sort);
  const fromOverview = params.from === "overview";
  const mayWrite = can(user, "tasks:write");
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const teamView = canViewSalesTeam(user.role);
  const ownerId = resolveSalesOwnerFilter(user.role, user.id, params.owner);

  const [rows, counts, owners] = await Promise.all([
    listFollowUps(user.orgId, {
      ownerId,
      scope,
      sorts,
      search: params.q,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    getFollowUpCounts(user.orgId, ownerId),
    teamView ? listSalesOwners(user.orgId) : Promise.resolve([]),
  ]);

  const total = rows[0]?.totalCount ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const buildHref = (next: Partial<{ scope: string; page: number }>) => {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    if (params.owner) query.set("owner", params.owner);
    if (params.sort !== undefined) query.set("sort", params.sort);
    if (params.from) query.set("from", params.from);
    const nextScope = next.scope ?? scope;
    if (nextScope !== "due") query.set("scope", nextScope);
    const nextPage = next.page ?? 1;
    if (nextPage > 1) query.set("page", String(nextPage));
    const suffix = query.toString();
    return suffix ? `/follow-ups?${suffix}` : "/follow-ups";
  };
  const returnTo = buildHref({ page });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mt-0.5 text-sm text-zinc-500">
            {formatNumber(counts.overdue)} overdue · {formatNumber(counts.due)} scheduled ·{" "}
            {formatNumber(counts.missing)} with no next step
          </p>
        </div>
        <form method="get" className="flex flex-wrap items-center gap-2">
          {params.sort !== undefined && <input type="hidden" name="sort" value={params.sort} />}
          {scope !== "due" && <input type="hidden" name="scope" value={scope} />}
          <input
            type="search"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Name, phone, reference"
            className="w-56 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          {teamView && (
            <select
              name="owner"
              defaultValue={ownerId ?? ""}
              aria-label="Lead owner"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="">Everyone</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>{owner.name}</option>
              ))}
            </select>
          )}
          <button type="submit" className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
            Search
          </button>
        </form>
      </div>

      {params.notice && (
        <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          {params.notice}
        </p>
      )}
      {params.error && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {params.error}
        </p>
      )}

      <FollowUpSortControls active={sorts} fromOverview={fromOverview} overdueCount={counts.overdue} />

      <div className="flex flex-wrap gap-2">
        {FOLLOW_UP_SCOPES.map((option) => (
          <Link
            key={option}
            href={buildHref({ scope: option })}
            aria-current={scope === option ? "page" : undefined}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
              scope === option
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            }`}
          >
            {FOLLOW_UP_SCOPE_LABELS[option]}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title={scope === "missing" ? "Every open lead has a next step" : "Nothing to follow up"}
            hint={
              scope === "missing"
                ? "Leads appear here the moment they lose their next action."
                : "Move a card past Contacted on the pipeline and you will be asked to set one."
            }
          />
        </Card>
      ) : (
        <div className="space-y-2.5">
          {rows.map((row) => (
            <Card key={row.leadId} className={row.isOverdue ? "border-red-300 dark:border-red-900/70" : ""}>
              <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/leads/${row.leadId}`} className="font-semibold hover:underline">
                      {row.fullName ?? row.reference}
                    </Link>
                    <StageBadge stage={row.stage} />
                    {row.isOverdue && (
                      <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">
                        overdue
                      </span>
                    )}
                    {row.openFollowUps > 1 && (
                      <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        +{row.openFollowUps - 1} more queued
                      </span>
                    )}
                  </div>

                  <p className="tabular mt-1 text-xs text-zinc-500">
                    {maskPhoneDisplay(row.primaryPhone)} · {row.reference}
                    {row.projectName ? ` · ${row.projectName}` : ""}
                    {row.ownerName ? ` · ${row.ownerName}` : " · unassigned"}
                  </p>

                  {row.dueAt ? (
                    <p className={`mt-2 flex items-center gap-1.5 text-sm ${row.isOverdue ? "font-medium text-red-600 dark:text-red-400" : "text-zinc-600 dark:text-zinc-300"}`}>
                      <AlarmClock aria-hidden className="size-3.5" />
                      {row.channel && isFollowUpChannel(row.channel)
                        ? FOLLOW_UP_CHANNEL_LABELS[row.channel]
                        : "Follow up"}{" "}
                      {formatRelative(row.dueAt)}
                      <span className="text-xs font-normal text-zinc-500">· {formatDateTime(row.dueAt)}</span>
                    </p>
                  ) : (
                    <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-400">
                      <AlarmClock aria-hidden className="size-3.5" />
                      No next step scheduled
                    </p>
                  )}

                  {row.subject && <p className="mt-1 text-sm">{row.subject}</p>}
                  {row.body && <p className="mt-0.5 text-sm text-zinc-500">{row.body}</p>}
                  <p className="mt-1.5 text-xs text-zinc-400">
                    Last activity {formatRelative(row.lastActivityAt ?? row.createdAt)}
                    {row.assigneeName ? ` · assigned to ${row.assigneeName}` : ""}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap items-start gap-2">
                  {row.primaryPhone && (
                    <a
                      href={`tel:${row.primaryPhone}`}
                      className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      <Phone aria-hidden className="size-3.5" />
                      Call
                    </a>
                  )}
                  {!mayWrite ? null : row.taskId ? (
                    <>
                      <form action={rescheduleTask} className="flex items-center gap-1.5">
                        <input type="hidden" name="taskId" value={row.taskId} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <input
                          type="datetime-local"
                          name="dueAt"
                          required
                          aria-label={`Reschedule follow-up for ${row.fullName ?? row.reference}`}
                          className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-950"
                        />
                        <SubmitButton variant="secondary" className="px-2.5 py-1.5 text-xs">
                          Move
                        </SubmitButton>
                      </form>
                      <form action={completeTask}>
                        <input type="hidden" name="taskId" value={row.taskId} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <SubmitButton className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs">
                          <Check aria-hidden className="size-3.5" />
                          Done
                        </SubmitButton>
                      </form>
                    </>
                  ) : (
                    <Link
                      href={`/tasks?lead=${row.leadId}`}
                      className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
                      prefetch={false}
                    >
                      <CalendarPlus aria-hidden className="size-3.5" />
                      Schedule
                    </Link>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between text-sm" aria-label="Follow-up pages">
          {page > 1 ? (
            <Link href={buildHref({ page: page - 1 })} className="rounded-lg border border-zinc-300 px-3 py-2 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-zinc-500">Page {page} of {pages}</span>
          {page < pages ? (
            <Link href={buildHref({ page: page + 1 })} className="rounded-lg border border-zinc-300 px-3 py-2 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
