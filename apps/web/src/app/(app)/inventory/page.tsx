import Link from "next/link";
import { Card, DataTable, EmptyState, SubmitButton, Td, Th } from "@/components/ui";
import { can, requirePermission } from "@/lib/auth";
import {
  createUnitAction,
  holdUnitAction,
  releaseUnitHoldAction,
  setUnitStatusAction,
  updateUnitAction,
} from "@/lib/commercial-actions";
import {
  listCommercialLeads,
  listCommercialProjects,
  listInventory,
} from "@/lib/commercial-queries";
import { formatDateTime, formatINR } from "@/lib/format";

export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-700 dark:bg-zinc-950";

const UNIT_STATUSES = [
  "available",
  "held",
  "token_paid",
  "booked",
  "registered",
  "blocked",
] as const;

const statusClass: Record<string, string> = {
  available: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  held: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  token_paid: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300",
  booked: "bg-green-600 text-white",
  registered: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  blocked: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

function UnitStatus({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${statusClass[status] ?? statusClass.blocked}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    project?: string;
    status?: string;
    configuration?: string;
    q?: string;
  }>;
}) {
  const user = await requirePermission("inventory:read");
  const params = await searchParams;
  const filters = {
    projectId: params.project?.trim() || undefined,
    status: params.status?.trim() || undefined,
    configuration: params.configuration?.trim() || undefined,
    search: params.q?.trim() || undefined,
  };
  const mayWrite = can(user, "inventory:write");
  const [projects, rows, leads] = await Promise.all([
    listCommercialProjects(user.orgId),
    listInventory(user.orgId, filters),
    mayWrite ? listCommercialLeads(user.orgId) : Promise.resolve([]),
  ]);
  const configurations = [...new Set(rows.map((row) => row.configuration))].sort();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Inventory</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Live sellable units. Holds expire automatically; financial states come from bookings.
          </p>
        </div>
        <Link
          href="/bookings"
          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Booking register
        </Link>
      </div>

      <Card>
        <form method="get" className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <input
            type="search"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Unit, tower, lead…"
            className={inputClass}
          />
          <select name="project" defaultValue={params.project ?? ""} className={inputClass}>
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={params.status ?? ""} className={inputClass}>
            <option value="">All statuses</option>
            {UNIT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <select
            name="configuration"
            defaultValue={params.configuration ?? ""}
            className={inputClass}
          >
            <option value="">All configurations</option>
            {configurations.map((configuration) => (
              <option key={configuration}>{configuration}</option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Apply filters
          </button>
        </form>
      </Card>

      {mayWrite && (
        <Card title="Add inventory" subtitle="Project and unit number form the commercial identity.">
          <form action={createUnitAction} className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-500">Project *</span>
              <select name="projectId" required className={inputClass}>
                <option value="">Select project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <Field label="Tower" name="tower" placeholder="A" />
            <Field label="Unit number *" name="unitNumber" required placeholder="1204" />
            <Field label="Floor" name="floor" type="number" />
            <Field label="Configuration *" name="configuration" required placeholder="3 BHK" />
            <Field label="Carpet area (sq ft)" name="carpetAreaSqft" type="number" step="0.01" />
            <Field label="Saleable area (sq ft)" name="saleableAreaSqft" type="number" step="0.01" />
            <Field label="Facing" name="facing" placeholder="East" />
            <Field label="Base price" name="basePrice" type="number" step="0.01" />
            <Field label="All-in price" name="allInPrice" type="number" step="0.01" />
            <div className="flex items-end sm:col-span-2">
              <SubmitButton className="w-full">Add unit</SubmitButton>
            </div>
          </form>
        </Card>
      )}

      <Card title={`${rows.length} units`} subtitle="Up to 500 units are shown for the current filter.">
        {rows.length === 0 ? (
          <EmptyState title="No matching inventory" hint="Change the filters or add the first unit." />
        ) : (
          <DataTable>
            <thead className="border-b border-zinc-100 dark:border-zinc-800">
              <tr>
                <Th>Unit</Th>
                <Th>Project</Th>
                <Th>Configuration</Th>
                <Th>Area</Th>
                <Th>All-in price</Th>
                <Th>Status / hold</Th>
                {mayWrite && <Th>Actions</Th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.map((unit) => {
                const eligibleLeads = leads.filter((lead) => lead.projectId === unit.projectId);
                return (
                  <tr key={unit.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <Td>
                      <p className="font-medium">
                        {unit.tower ? `${unit.tower} · ` : ""}
                        {unit.unitNumber}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {unit.floor == null ? "Floor —" : `Floor ${unit.floor}`}
                        {unit.facing ? ` · ${unit.facing}` : ""}
                      </p>
                    </Td>
                    <Td>{unit.projectName}</Td>
                    <Td>{unit.configuration}</Td>
                    <Td className="tabular text-zinc-600 dark:text-zinc-400">
                      {unit.carpetAreaSqft ? `${Number(unit.carpetAreaSqft).toLocaleString("en-IN")} sq ft` : "—"}
                    </Td>
                    <Td className="tabular font-medium">{formatINR(unit.allInPrice, true)}</Td>
                    <Td>
                      <UnitStatus status={unit.status} />
                      {unit.holdId && (
                        <div className="mt-1 text-xs text-zinc-500">
                          <Link href={`/leads/${unit.heldForLeadId}`} className="font-medium hover:underline">
                            {unit.heldForName ?? unit.heldForLeadReference}
                          </Link>
                          <span className="block">until {formatDateTime(unit.holdExpiresAt)}</span>
                        </div>
                      )}
                    </Td>
                    {mayWrite && (
                      <Td className="min-w-[250px]">
                        <details>
                          <summary className="cursor-pointer text-sm font-medium text-brand-600">
                            Manage
                          </summary>
                          <div className="mt-3 space-y-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                            <form action={updateUnitAction} className="grid gap-2 sm:grid-cols-2">
                              <input type="hidden" name="unitId" value={unit.id} />
                              <Field label="Tower" name="tower" defaultValue={unit.tower ?? ""} compact />
                              <Field label="Unit" name="unitNumber" defaultValue={unit.unitNumber} required compact />
                              <Field label="Floor" name="floor" type="number" defaultValue={unit.floor ?? ""} compact />
                              <Field label="Configuration" name="configuration" defaultValue={unit.configuration} required compact />
                              <Field label="Carpet sq ft" name="carpetAreaSqft" type="number" step="0.01" defaultValue={unit.carpetAreaSqft ?? ""} compact />
                              <Field label="Saleable sq ft" name="saleableAreaSqft" type="number" step="0.01" defaultValue={unit.saleableAreaSqft ?? ""} compact />
                              <Field label="Facing" name="facing" defaultValue={unit.facing ?? ""} compact />
                              <Field label="Base price" name="basePrice" type="number" step="0.01" defaultValue={unit.basePrice ?? ""} compact />
                              <Field label="All-in price" name="allInPrice" type="number" step="0.01" defaultValue={unit.allInPrice ?? ""} compact />
                              <div className="flex items-end">
                                <SubmitButton variant="secondary" className="w-full py-1.5 text-xs">
                                  Save unit
                                </SubmitButton>
                              </div>
                            </form>

                            {(unit.status === "available" || unit.status === "blocked") && (
                              <form action={setUnitStatusAction} className="flex items-end gap-2">
                                <input type="hidden" name="unitId" value={unit.id} />
                                <label className="min-w-0 flex-1">
                                  <span className="mb-1 block text-xs text-zinc-500">Availability</span>
                                  <select name="status" defaultValue={unit.status} className={inputClass}>
                                    <option value="available">Available</option>
                                    <option value="blocked">Blocked</option>
                                  </select>
                                </label>
                                <SubmitButton variant="secondary">Update</SubmitButton>
                              </form>
                            )}

                            {unit.holdId ? (
                              <form action={releaseUnitHoldAction} className="space-y-2">
                                <input type="hidden" name="holdId" value={unit.holdId} />
                                <input
                                  name="releaseReason"
                                  required
                                  defaultValue="Released manually"
                                  className={inputClass}
                                />
                                <SubmitButton variant="danger" className="w-full">
                                  Release hold
                                </SubmitButton>
                              </form>
                            ) : (
                              unit.status === "available" && (
                                <form action={holdUnitAction} className="space-y-2">
                                  <input type="hidden" name="unitId" value={unit.id} />
                                  <label className="block">
                                    <span className="mb-1 block text-xs text-zinc-500">Hold for lead</span>
                                    <select name="leadId" required className={inputClass}>
                                      <option value="">Select lead</option>
                                      {eligibleLeads.map((lead) => (
                                        <option key={lead.id} value={lead.id}>
                                          {lead.reference} · {lead.fullName ?? lead.primaryPhone ?? "Unnamed"}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <div className="grid grid-cols-2 gap-2">
                                    <Field label="Hours" name="hours" type="number" defaultValue={48} required compact />
                                    <Field label="Reason" name="reason" placeholder="Price discussion" compact />
                                  </div>
                                  <SubmitButton className="w-full">Place hold</SubmitButton>
                                </form>
                              )
                            )}
                          </div>
                        </details>
                      </Td>
                    )}
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

function Field({
  label,
  name,
  compact = false,
  ...props
}: {
  label: string;
  name: string;
  compact?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-zinc-500">{label}</span>
      <input
        name={name}
        {...props}
        className={`${inputClass} ${compact ? "py-1.5 text-xs" : ""}`}
      />
    </label>
  );
}
