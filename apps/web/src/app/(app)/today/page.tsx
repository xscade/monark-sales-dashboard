import Link from "next/link";
import { can, requirePermission } from "@/lib/auth";
import { completeTask } from "@/lib/sales-actions";
import {
  canViewSalesTeam,
  canManageSalesTeam,
  getTodaySalesQueue,
  listSalesOwners,
  resolveSalesOwnerFilter,
} from "@/lib/sales-queries";
import { formatDateTime, formatRelative, maskPhoneDisplay } from "@/lib/format";
import { Card, EmptyState, StageBadge, SubmitButton } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ owner?: string; notice?: string; error?: string }>;
}) {
  const user = await requirePermission("tasks:read");
  const params = await searchParams;
  const teamView = canViewSalesTeam(user.role);
  const teamManage = canManageSalesTeam(user.role);
  const ownerId = resolveSalesOwnerFilter(user.role, user.id, params.owner);
  const [queue, owners] = await Promise.all([
    getTodaySalesQueue(user.orgId, user.timezone, ownerId),
    teamView ? listSalesOwners(user.orgId) : Promise.resolve([]),
  ]);

  const returnParams = new URLSearchParams();
  if (params.owner) returnParams.set("owner", params.owner);
  const returnTo = returnParams.size ? `/today?${returnParams}` : "/today";
  const mayWrite = can(user, "tasks:write");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Today</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            {ownerId === user.id ? "Your daily sales queue" : "Team sales queue"}
          </p>
        </div>

        {teamView && (
          <form method="get" className="flex items-center gap-2">
            <label htmlFor="today-owner" className="text-xs font-medium text-zinc-500">
              Owner
            </label>
            <select
              id="today-owner"
              name="owner"
              defaultValue={ownerId ?? ""}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="">Everyone</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Apply
            </button>
          </form>
        )}
      </div>

      {params.notice && (
        <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
          {params.notice}
        </p>
      )}
      {params.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
          {params.error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <QueueCount label="Unworked leads" value={queue.newLeads.length} tone="amber" />
        <QueueCount label="Tasks due" value={queue.tasks.length} tone="red" />
        <QueueCount label="Visits today" value={queue.visits.length} tone="blue" />
      </div>

      <Card title="Tasks due" subtitle="Overdue work appears first">
        {queue.tasks.length === 0 ? (
          <EmptyState title="No tasks due" hint="Your overdue and due-today follow-ups will appear here." />
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {queue.tasks.map((task) => {
              const overdue = Boolean(task.dueAt && new Date(task.dueAt) < new Date());
              return (
                <li key={task.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{task.subject ?? "Follow up"}</p>
                    <p className="mt-0.5 truncate text-xs text-zinc-500">
                      {task.leadId ? (
                        <Link href={`/leads/${task.leadId}`} className="hover:underline">
                          {task.customerName ?? task.leadReference ?? "Lead"}
                        </Link>
                      ) : (
                        (task.customerName ?? "Customer")
                      )}
                      {task.projectName ? ` · ${task.projectName}` : ""}
                      {task.assigneeName && ownerId !== user.id ? ` · ${task.assigneeName}` : ""}
                    </p>
                  </div>
                  <time
                    className={`shrink-0 text-xs font-medium ${
                      overdue ? "text-red-600 dark:text-red-400" : "text-zinc-500"
                    }`}
                  >
                    {task.dueAt ? formatRelative(task.dueAt) : "No due date"}
                  </time>
                  {mayWrite && (teamManage || task.userId === user.id) && (
                    <form action={completeTask}>
                      <input type="hidden" name="taskId" value={task.id} />
                      <input type="hidden" name="returnTo" value={returnTo} />
                      <SubmitButton variant="secondary">Complete</SubmitButton>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t border-zinc-100 px-5 py-3 text-right dark:border-zinc-800">
          <Link href="/tasks" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-500">
            View all tasks →
          </Link>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Unworked leads" subtitle="Oldest first">
          {queue.newLeads.length === 0 ? (
            <EmptyState title="No unworked leads" />
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {queue.newLeads.map((lead) => (
                <li key={lead.id}>
                  <Link
                    href={`/leads/${lead.id}`}
                    className="flex items-center justify-between gap-3 px-5 py-3 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{lead.fullName ?? lead.reference}</p>
                      <p className="tabular mt-0.5 truncate text-xs text-zinc-500">
                        {maskPhoneDisplay(lead.primaryPhone)}
                        {lead.projectName ? ` · ${lead.projectName}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <StageBadge stage={lead.stage} />
                      <p className="mt-1 text-xs text-zinc-500">{formatRelative(lead.createdAt)}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Visits today" subtitle={`Times shown in ${user.timezone}`}>
          {queue.visits.length === 0 ? (
            <EmptyState title="No visits scheduled" />
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {queue.visits.map((visit) => (
                <li key={visit.id}>
                  <Link
                    href={`/leads/${visit.leadId}`}
                    className="flex items-center justify-between gap-3 px-5 py-3 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {visit.customerName ?? visit.leadReference}
                      </p>
                      <p className="mt-0.5 truncate text-xs capitalize text-zinc-500">
                        {visit.type.replace(/_/g, " ")}
                        {visit.projectName ? ` · ${visit.projectName}` : ""}
                        {visit.hostName && ownerId !== user.id ? ` · ${visit.hostName}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-medium">{formatDateTime(visit.scheduledAt, user.timezone)}</p>
                      <p className="mt-0.5 text-xs capitalize text-zinc-500">{visit.status}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function QueueCount({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "amber" | "red" | "blue";
}) {
  const toneClass = {
    amber: "text-amber-600 dark:text-amber-400",
    red: "text-red-600 dark:text-red-400",
    blue: "text-blue-600 dark:text-blue-400",
  }[tone];
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`tabular mt-1 text-2xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}
