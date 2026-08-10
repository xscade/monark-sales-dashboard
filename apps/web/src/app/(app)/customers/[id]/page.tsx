import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { can, requirePermission } from "@/lib/auth";
import { createTask } from "@/lib/sales-actions";
import { setCustomerSuppression, updateCustomer } from "@/lib/customer-actions";
import {
  canViewSalesTeam,
  getCustomerDetail,
  listSalesOwners,
} from "@/lib/sales-queries";
import { formatDate, formatDateTime, formatRelative } from "@/lib/format";
import { Card, EmptyState, SourceBadge, StageBadge, SubmitButton } from "@/components/ui";

export const dynamic = "force-dynamic";

type TimelineItem = {
  id: string;
  at: Date;
  kind: "activity" | "task" | "visit";
  title: string;
  detail: string | null;
  meta: string | null;
};

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const user = await requirePermission("customers:read");
  const [{ id }, messages] = await Promise.all([params, searchParams]);
  if (!z.string().uuid().safeParse(id).success) notFound();

  const teamView = canViewSalesTeam(user.role);
  const ownerScope = user.role === "sales_agent" ? user.id : undefined;
  const [data, owners] = await Promise.all([
    getCustomerDetail(user.orgId, id, ownerScope),
    teamView ? listSalesOwners(user.orgId) : Promise.resolve([]),
  ]);
  if (!data) notFound();

  const { customer, opportunities, activities, visits } = data;
  const activeOpportunities = opportunities.filter(
    (lead) => !["booked", "lost", "disqualified"].includes(lead.stage),
  );
  const taskOpportunities = user.role === "sales_agent"
    ? activeOpportunities.filter((lead) => lead.ownerUserId === user.id)
    : activeOpportunities;
  const mayWriteCustomer = can(user, "customers:write");
  const mayWriteTasks = can(user, "tasks:write");

  const timeline: TimelineItem[] = [
    ...activities.map((activity) => ({
      id: `activity-${activity.id}`,
      at: new Date(activity.occurredAt),
      kind: activity.type === "task" ? ("task" as const) : ("activity" as const),
      title:
        activity.type === "task"
          ? activity.completedAt
            ? `Task completed — ${activity.subject ?? "Follow up"}`
            : `Task created — ${activity.subject ?? "Follow up"}`
          : activity.subject ?? activity.type.replace(/_/g, " "),
      detail: activity.body,
      meta: [
        activity.userName,
        activity.leadReference,
        activity.dueAt ? `due ${formatDateTime(activity.dueAt, user.timezone)}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || null,
    })),
    ...visits.map((visit) => ({
      id: `visit-${visit.id}`,
      at: new Date(visit.arrivedAt ?? visit.scheduledAt ?? 0),
      kind: "visit" as const,
      title: `${visit.type.replace(/_/g, " ")} — ${visit.status.replace(/_/g, " ")}`,
      detail: visit.notes,
      meta: [visit.hostName, visit.leadReference].filter(Boolean).join(" · ") || null,
    })),
  ]
    .filter((item) => !Number.isNaN(item.at.getTime()))
    .sort((a, b) => b.at.getTime() - a.at.getTime());

  const dotClass: Record<TimelineItem["kind"], string> = {
    activity: "bg-zinc-400",
    task: "bg-blue-500",
    visit: "bg-amber-500",
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/customers" className="text-xs text-zinc-500 hover:underline">
            ← Customers
          </Link>
          <h2 className="mt-1 text-xl font-semibold">{customer.fullName ?? "Unnamed customer"}</h2>
          <p className="tabular mt-0.5 text-sm text-zinc-500">
            {customer.primaryPhone ?? "No phone"}
            {customer.primaryEmail ? ` · ${customer.primaryEmail}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {customer.isNri && (
            <span className="rounded-md bg-violet-100 px-2 py-1 text-xs font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">
              NRI
            </span>
          )}
          {customer.isSuppressed && (
            <span className="rounded-md bg-red-100 px-2 py-1 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
              Do not contact
            </span>
          )}
        </div>
      </div>

      {messages.notice && (
        <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
          {messages.notice}
        </p>
      )}
      {messages.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
          {messages.error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Opportunities" subtitle={`${opportunities.length} across all projects`}>
            {opportunities.length === 0 ? (
              <EmptyState title="No opportunities" />
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {opportunities.map((lead) => (
                  <li key={lead.id}>
                    <Link
                      href={`/leads/${lead.id}`}
                      className="flex items-center justify-between gap-3 px-5 py-3 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{lead.projectName ?? lead.reference}</p>
                          {lead.source && <SourceBadge source={lead.source} />}
                        </div>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          {lead.reference}
                          {lead.ownerName ? ` · ${lead.ownerName}` : " · Unassigned"}
                          {lead.lastActivityAt ? ` · active ${formatRelative(lead.lastActivityAt)}` : ""}
                        </p>
                      </div>
                      <StageBadge stage={lead.stage} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Timeline" subtitle={`${timeline.length} activities and visits`}>
            {timeline.length === 0 ? (
              <EmptyState title="Nothing recorded yet" />
            ) : (
              <ol className="px-5 py-4">
                {timeline.slice(0, 150).map((item, index) => (
                  <li key={item.id} className="relative flex gap-3 pb-4 last:pb-0">
                    <div className="flex flex-col items-center">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotClass[item.kind]}`} />
                      {index < Math.min(timeline.length, 150) - 1 && (
                        <span className="mt-1 w-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-medium capitalize">{item.title}</p>
                        <time className="shrink-0 text-xs text-zinc-500">
                          {formatDateTime(item.at, user.timezone)}
                        </time>
                      </div>
                      {item.detail && (
                        <p className="mt-0.5 whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-400">
                          {item.detail}
                        </p>
                      )}
                      {item.meta && <p className="mt-0.5 text-xs text-zinc-500">{item.meta}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Customer details">
            <dl className="space-y-3 px-5 py-4 text-sm">
              <DetailRow label="Phone">{customer.primaryPhone ?? "—"}</DetailRow>
              <DetailRow label="Email">{customer.primaryEmail ?? "—"}</DetailRow>
              <DetailRow label="Location">
                {[customer.city, customer.state, customer.postalCode].filter(Boolean).join(", ") || "—"}
              </DetailRow>
              <DetailRow label="Language">{customer.preferredLanguage ?? "—"}</DetailRow>
              <DetailRow label="Customer since">{formatDate(customer.createdAt, user.timezone)}</DetailRow>
              {customer.isSuppressed && (
                <DetailRow label="Suppression">{customer.suppressionReason ?? "No reason recorded"}</DetailRow>
              )}
            </dl>
          </Card>

          {mayWriteCustomer && (
            <Card title="Edit customer" subtitle="Identity changes remain linked to past enquiries">
              <form action={updateCustomer} className="grid gap-3 p-5">
                <input type="hidden" name="personId" value={customer.id} />
                <label className="grid gap-1"><span className="text-xs text-zinc-500">Full name</span><input name="fullName" defaultValue={customer.fullName ?? ""} maxLength={160} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" /></label>
                <label className="grid gap-1"><span className="text-xs text-zinc-500">Phone</span><input name="primaryPhone" type="tel" defaultValue={customer.primaryPhone ?? ""} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" /></label>
                <label className="grid gap-1"><span className="text-xs text-zinc-500">Email</span><input name="primaryEmail" type="email" defaultValue={customer.primaryEmail ?? ""} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" /></label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1"><span className="text-xs text-zinc-500">City</span><input name="city" defaultValue={customer.city ?? ""} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" /></label>
                  <label className="grid gap-1"><span className="text-xs text-zinc-500">State</span><input name="state" defaultValue={customer.state ?? ""} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" /></label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1"><span className="text-xs text-zinc-500">Postal code</span><input name="postalCode" defaultValue={customer.postalCode ?? ""} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" /></label>
                  <label className="grid gap-1"><span className="text-xs text-zinc-500">Language</span><input name="preferredLanguage" defaultValue={customer.preferredLanguage ?? ""} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" /></label>
                </div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isNri" defaultChecked={customer.isNri} className="size-4 accent-brand-600" />NRI customer</label>
                <SubmitButton variant="secondary" className="w-full">Save customer</SubmitButton>
              </form>
            </Card>
          )}

          {mayWriteCustomer && (
            <Card title="Contact controls" subtitle="Suppression also blocks outbound conversion delivery">
              <form action={setCustomerSuppression} className="space-y-3 p-5">
                <input type="hidden" name="personId" value={customer.id} />
                <input type="hidden" name="suppressed" value={customer.isSuppressed ? "false" : "true"} />
                {!customer.isSuppressed && <textarea name="reason" rows={2} required placeholder="Reason for do-not-contact…" className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" />}
                <SubmitButton variant={customer.isSuppressed ? "secondary" : "danger"} className="w-full">
                  {customer.isSuppressed ? "Remove suppression" : "Mark do not contact"}
                </SubmitButton>
                {customer.isSuppressed && <p className="text-xs text-zinc-500">Removing suppression does not restore previously withdrawn consent.</p>}
              </form>
            </Card>
          )}

          {mayWriteTasks && taskOpportunities.length > 0 && (
            <Card title="Create follow-up task">
              <form action={createTask} className="space-y-3 p-5">
                <input type="hidden" name="submissionId" value={randomUUID()} />
                <input type="hidden" name="returnTo" value={`/customers/${customer.id}`} />
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-zinc-500">Opportunity</span>
                  <select
                    name="leadId"
                    required
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  >
                    {taskOpportunities.map((lead) => (
                      <option key={lead.id} value={lead.id}>
                        {lead.projectName ?? lead.reference}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-zinc-500">Task</span>
                  <input
                    name="subject"
                    required
                    maxLength={200}
                    placeholder="Call with pricing update"
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-zinc-500">Due</span>
                  <input
                    type="datetime-local"
                    name="dueAt"
                    required
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  />
                </label>
                {teamView ? (
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-zinc-500">Assignee</span>
                    <select
                      name="assigneeId"
                      defaultValue={user.id}
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
                <textarea
                  name="body"
                  rows={2}
                  maxLength={5000}
                  placeholder="Context…"
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                />
                <SubmitButton className="w-full">Add task</SubmitButton>
              </form>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-xs text-zinc-500">{label}</dt>
      <dd className="min-w-0 break-words text-right">{children}</dd>
    </div>
  );
}
