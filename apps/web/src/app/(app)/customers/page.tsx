import Link from "next/link";
import { Check } from "lucide-react";
import { can, requirePermission } from "@/lib/auth";
import {
  canViewSalesTeam,
  listCustomers,
  listSalesOwners,
  normalizeCustomerSegment,
  resolveSalesOwnerFilter,
} from "@/lib/sales-queries";
import { formatNumber, formatRelative, maskPhoneDisplay } from "@/lib/format";
import { Card, DataTable, EmptyState, StageBadge, Td, Th } from "@/components/ui";
import { LeadActions } from "@/components/lead-actions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ owner?: string; q?: string; page?: string; segment?: string; disqualified?: string }>;
}) {
  const user = await requirePermission("customers:read");
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const segment = normalizeCustomerSegment(params.segment);
  const includeDisqualified = params.disqualified === "1";
  const mayWrite = can(user, "leads:write");
  const teamView = canViewSalesTeam(user.role);
  const ownerId = resolveSalesOwnerFilter(user.role, user.id, params.owner);
  const [customers, owners] = await Promise.all([
    listCustomers(user.orgId, {
      ownerId,
      search: params.q,
      segment,
      includeDisqualified,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    teamView ? listSalesOwners(user.orgId) : Promise.resolve([]),
  ]);

  const total = customers[0]?.totalCount ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const buildHref = (nextPage: number, nextSegment = segment) => {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    if (params.owner) query.set("owner", params.owner);
    // Only the non-default segment needs to appear in the URL.
    if (nextSegment === "customers") query.set("segment", "customers");
    if (includeDisqualified) query.set("disqualified", "1");
    if (nextPage > 1) query.set("page", String(nextPage));
    const suffix = query.toString();
    return suffix ? `/customers?${suffix}` : "/customers";
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {/* No heading here: the header already says Customers, and the
              segment toggle below names the view more precisely than a title
              could. */}
          <p className="text-sm text-zinc-500">
            {segment === "customers"
              ? `${formatNumber(total)} customer${total === 1 ? "" : "s"} · everyone here has a live booking`
              : `${formatNumber(total)} contact${total === 1 ? "" : "s"} · enquiries included`}
          </p>
          {/* An enquiry is not a customer. Both views exist because the sales
              team needs the address book too — but the word has to mean
              something, or the count on this page answers no question at all. */}
          <div className="mt-2 inline-flex rounded-lg border border-zinc-300 p-0.5 text-xs dark:border-zinc-700">
            {(["contacts", "customers"] as const).map((option) => (
              <Link
                key={option}
                href={buildHref(1, option)}
                aria-current={segment === option ? "page" : undefined}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  segment === option
                    ? "bg-brand-600 text-white"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                {option === "customers" ? "Customers" : "All contacts"}
              </Link>
            ))}
          </div>
          <Link
            href={(() => {
              const query = new URLSearchParams();
              if (params.q) query.set("q", params.q);
              if (params.owner) query.set("owner", params.owner);
              if (segment === "customers") query.set("segment", "customers");
              if (!includeDisqualified) query.set("disqualified", "1");
              const suffix = query.toString();
              return suffix ? `/customers?${suffix}` : "/customers";
            })()}
            className="ml-2 inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <input type="checkbox" readOnly checked={includeDisqualified} className="size-3.5 accent-brand-600" />
            Show disqualified
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can(user, "visits:write") && <Link
            href="/walk-ins/new"
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Add customer
          </Link>}
        <form method="get" className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Name, phone, email, reference"
            className="w-64 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
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
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="submit"
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Search
          </button>
        </form>
        </div>
      </div>

      <Card>
        {customers.length === 0 ? (
          <EmptyState
            title={segment === "customers" ? "No customers yet" : "No contacts match"}
            hint={
              segment === "customers"
                ? "A contact becomes a customer when their booking is confirmed. Switch to All contacts to see open enquiries. This is the list WhatsApp marketing will draw on."
                : "Try clearing the search or owner filter."
            }
          />
        ) : (
          <DataTable>
            <thead className="border-b border-zinc-100 dark:border-zinc-800">
              <tr>
                <Th>Customer</Th>
                <Th>Projects</Th>
                <Th>Owner</Th>
                <Th>Status</Th>
                <Th className="text-right">Opportunities</Th>
                <Th>Last activity</Th>
                {mayWrite && <Th>Actions</Th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {customers.map((customer) => (
                <tr key={customer.id} className="transition hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <Td>
                    <Link href={`/customers/${customer.id}`} className="block">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{customer.fullName ?? "Unnamed customer"}</p>
                        {customer.isNri && (
                          <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                            NRI
                          </span>
                        )}
                        {customer.isSuppressed && (
                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                            DNC
                          </span>
                        )}
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            customer.bookingCount > 0
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                              : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                          }`}
                        >
                          {customer.bookingCount > 0 ? "Customer" : "Lead"}
                        </span>
                        {customer.validatedBookingCount > 0 && (
                          <span
                            title="Accounts has matched this customer's booking amount against the bank"
                            className="inline-flex items-center gap-0.5 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-medium text-white"
                          >
                            <Check className="size-2.5" strokeWidth={3} />
                            Validated
                          </span>
                        )}
                      </div>
                      <p className="tabular mt-0.5 text-xs text-zinc-500">
                        {maskPhoneDisplay(customer.primaryPhone)}
                        {customer.primaryEmail ? ` · ${customer.primaryEmail}` : ""}
                      </p>
                    </Link>
                  </Td>
                  <Td className="max-w-64 truncate text-zinc-600 dark:text-zinc-400">
                    {customer.projectNames ?? "—"}
                  </Td>
                  <Td className="max-w-48 truncate text-zinc-600 dark:text-zinc-400">
                    {customer.ownerNames ?? "Unassigned"}
                  </Td>
                  <Td>
                    {customer.primaryStage ? <StageBadge stage={customer.primaryStage} /> : "—"}
                  </Td>
                  <Td className="tabular text-right">
                    <span className="font-medium">{customer.openOpportunityCount}</span>
                    <span className="text-zinc-400"> / {customer.opportunityCount}</span>
                  </Td>
                  <Td className="whitespace-nowrap text-zinc-500">
                    {formatRelative(customer.lastActivityAt)}
                  </Td>
                  {mayWrite && (
                    <Td>
                      {customer.primaryLeadId && customer.primaryStage ? (
                        <LeadActions
                          leadId={customer.primaryLeadId}
                          leadName={customer.fullName ?? "this contact"}
                          stage={customer.primaryStage}
                          showPromote
                          compact
                        />
                      ) : null}
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>

      {pages > 1 && (
        <nav className="flex items-center justify-between text-sm" aria-label="Customer pages">
          {page > 1 ? (
            <Link href={buildHref(page - 1)} className="rounded-lg border border-zinc-300 px-3 py-2 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-zinc-500">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={buildHref(page + 1)} className="rounded-lg border border-zinc-300 px-3 py-2 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
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
