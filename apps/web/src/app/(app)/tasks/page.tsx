import { randomUUID } from "node:crypto";
import Link from "next/link";
import { can, requirePermission } from "@/lib/auth";
import { completeTask, createTask, rescheduleTask } from "@/lib/sales-actions";
import {
  canViewSalesTeam,
  canManageSalesTeam,
  listSalesOwners,
  listSalesTasks,
  listTaskTargets,
  normalizeTaskStatus,
  resolveSalesOwnerFilter,
  type TaskStatus,
} from "@/lib/sales-queries";
import { formatDateTime, maskPhoneDisplay } from "@/lib/format";
import { Card, DataTable, EmptyState, SubmitButton, Td, Th } from "@/components/ui";

export const dynamic = "force-dynamic";

const TASK_TABS: Array<{ value: TaskStatus; label: string }> = [
  { value: "open", label: "Open" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "completed", label: "Completed" },
];

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{
    owner?: string;
    status?: string;
    q?: string;
    notice?: string;
    error?: string;
  }>;
}) {
  const user = await requirePermission("tasks:read");
  const params = await searchParams;
  const status = normalizeTaskStatus(params.status);
  const teamView = canViewSalesTeam(user.role);
  const teamManage = canManageSalesTeam(user.role);
  const ownerId = resolveSalesOwnerFilter(user.role, user.id, params.owner);
  const [tasks, owners, targets] = await Promise.all([
    listSalesTasks(user.orgId, user.timezone, {
      ownerId,
      status,
      search: params.q,
    }),
    teamView ? listSalesOwners(user.orgId) : Promise.resolve([]),
    can(user, "tasks:write") ? listTaskTargets(user.orgId, ownerId) : Promise.resolve([]),
  ]);

  const buildHref = (overrides: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    const values = {
      status,
      owner: params.owner,
      q: params.q,
      ...overrides,
    };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, value);
    return `/tasks?${query}`;
  };
  const returnTo = buildHref({});
  const mayWrite = can(user, "tasks:write");
  const defaultAssignee = ownerId ?? user.id;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Tasks</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            {tasks.length} {status === "completed" ? "completed" : "matching"} task
            {tasks.length === 1 ? "" : "s"}
          </p>
        </div>
        <form method="get" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="status" value={status} />
          <input
            type="search"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Task, customer, phone, reference"
            className="w-64 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          {teamView && (
            <select
              name="owner"
              defaultValue={ownerId ?? ""}
              aria-label="Task owner"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="">Everyone</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="submit"
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Filter
          </button>
        </form>
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

      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900">
        {TASK_TABS.map((tab) => (
          <Link
            key={tab.value}
            href={buildHref({ status: tab.value })}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
              status === tab.value
                ? "bg-brand-600 text-white"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {mayWrite && (
        <Card title="New task" subtitle="Follow-ups stay linked to the customer and opportunity">
          {targets.length === 0 ? (
            <EmptyState title="No open leads available" hint="Create or assign a lead before adding a task." />
          ) : (
            <form action={createTask} className="grid gap-3 p-5 lg:grid-cols-12">
              <input type="hidden" name="submissionId" value={randomUUID()} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <label className="lg:col-span-4">
                <span className="mb-1 block text-xs font-medium text-zinc-500">Lead</span>
                <select
                  name="leadId"
                  required
                  defaultValue=""
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                >
                  <option value="" disabled>
                    Choose a lead…
                  </option>
                  {targets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.fullName ?? target.reference} · {target.projectName ?? target.reference}
                    </option>
                  ))}
                </select>
              </label>
              <label className="lg:col-span-3">
                <span className="mb-1 block text-xs font-medium text-zinc-500">Task</span>
                <input
                  name="subject"
                  required
                  maxLength={200}
                  placeholder="Call about site visit"
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                />
              </label>
              <label className="lg:col-span-2">
                <span className="mb-1 block text-xs font-medium text-zinc-500">Due</span>
                <input
                  type="datetime-local"
                  name="dueAt"
                  required
                  defaultValue={toDateTimeLocal(new Date(Date.now() + 60 * 60 * 1000), user.timezone)}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                />
              </label>
              {teamManage ? (
                <label className="lg:col-span-2">
                  <span className="mb-1 block text-xs font-medium text-zinc-500">Assignee</span>
                  <select
                    name="assigneeId"
                    defaultValue={defaultAssignee}
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  >
                    {owners.map((owner) => (
                      <option key={owner.id} value={owner.id}>
                        {owner.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <input type="hidden" name="assigneeId" value={user.id} />
              )}
              <div className="flex items-end lg:col-span-1">
                <SubmitButton className="w-full">Add</SubmitButton>
              </div>
              <label className="lg:col-span-12">
                <span className="sr-only">Notes</span>
                <textarea
                  name="body"
                  rows={2}
                  maxLength={5000}
                  placeholder="Context or desired outcome…"
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                />
              </label>
            </form>
          )}
        </Card>
      )}

      <Card>
        {tasks.length === 0 ? (
          <EmptyState title="No tasks match" hint="Try another status, owner, or search." />
        ) : (
          <DataTable>
            <thead className="border-b border-zinc-100 dark:border-zinc-800">
              <tr>
                <Th>Task</Th>
                <Th>Customer</Th>
                <Th>Assignee</Th>
                <Th>Due</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {tasks.map((task) => {
                const mayMutateTask = mayWrite && (teamManage || task.userId === user.id);
                const overdue = Boolean(
                  !task.completedAt && task.dueAt && new Date(task.dueAt).getTime() < Date.now(),
                );
                return (
                  <tr key={task.id} className="align-top">
                    <Td>
                      <p className={`font-medium ${task.completedAt ? "text-zinc-400 line-through" : ""}`}>
                        {task.subject ?? "Follow up"}
                      </p>
                      {task.body && <p className="mt-1 max-w-md whitespace-pre-wrap text-xs text-zinc-500">{task.body}</p>}
                    </Td>
                    <Td>
                      {task.personId ? (
                        <Link href={`/customers/${task.personId}`} className="font-medium hover:underline">
                          {task.customerName ?? "Customer"}
                        </Link>
                      ) : (
                        <span>{task.customerName ?? "—"}</span>
                      )}
                      <p className="tabular mt-0.5 text-xs text-zinc-500">
                        {maskPhoneDisplay(task.primaryPhone)}
                        {task.leadId && (
                          <>
                            {" · "}
                            <Link href={`/leads/${task.leadId}`} className="hover:underline">
                              {task.leadReference}
                            </Link>
                          </>
                        )}
                      </p>
                    </Td>
                    <Td className="text-zinc-600 dark:text-zinc-400">{task.assigneeName ?? "Unassigned"}</Td>
                    <Td>
                      <p className={overdue ? "font-medium text-red-600 dark:text-red-400" : ""}>
                        {formatDateTime(task.completedAt ?? task.dueAt, user.timezone)}
                      </p>
                      {task.completedAt && <p className="mt-0.5 text-xs text-zinc-500">Completed</p>}
                    </Td>
                    <Td className="text-right">
                      {mayMutateTask && !task.completedAt ? (
                        <div className="flex flex-col items-end gap-2">
                          <form action={completeTask}>
                            <input type="hidden" name="taskId" value={task.id} />
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <SubmitButton>Complete</SubmitButton>
                          </form>
                          <form action={rescheduleTask} className="flex items-center gap-1.5">
                            <input type="hidden" name="taskId" value={task.id} />
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <input
                              type="datetime-local"
                              name="dueAt"
                              required
                              defaultValue={task.dueAt ? toDateTimeLocal(task.dueAt, user.timezone) : ""}
                              aria-label={`Reschedule ${task.subject ?? "task"}`}
                              className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-950"
                            />
                            <SubmitButton variant="secondary">Move</SubmitButton>
                          </form>
                        </div>
                      ) : (
                        <span className="text-xs text-zinc-400">—</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </Card>
    </div>
  );
}

function toDateTimeLocal(value: Date | string, timezone: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
