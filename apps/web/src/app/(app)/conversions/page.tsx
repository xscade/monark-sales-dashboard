import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { getConversionHealth } from "@/lib/queries";
import { Card, DataTable, EmptyState, Td, Th } from "@/components/ui";
import { formatINR, formatNumber, formatRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_CLASS: Record<string, string> = {
  delivered: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  skipped_dry_run: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  pending: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  in_flight: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  failed_retryable: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  failed_permanent: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  ineligible: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  expired: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
};

/**
 * Conversion sync.
 *
 * Two things matter here and they are easy to confuse:
 *
 *   `ineligible` is the eligibility gate working — no consent, no usable
 *   identifier, a test lead, known spam. Withheld on purpose, never retried.
 *
 *   `expired` means the attribution window closed before delivery, almost
 *   always because the sales cycle outran Google's 90 days. Not a bug; the cost
 *   of selling something expensive.
 *
 * Neither is a failure, and showing them as one would send people chasing
 * problems that do not exist.
 */
export default async function ConversionsPage() {
  const user = await requirePermission("conversions:read");
  const { byStatus, lagMinutes, recent, destinations } = await getConversionHealth(user.orgId);

  const counts = Object.fromEntries(byStatus.map((s) => [s.status, s.count]));
  const lagCritical = lagMinutes > 180;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Conversion sync</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Offline events queued for Meta and Google
        </p>
      </div>

      {lagCritical && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-5 py-4 dark:border-red-900 dark:bg-red-950/40">
          <p className="text-sm font-semibold text-red-800 dark:text-red-300">
            Outbox lag is {formatNumber(lagMinutes)} minutes
          </p>
          <p className="mt-1 text-sm text-red-700 dark:text-red-400">
            Meta rejects any event whose timestamp is more than 7 days old — and rejects the whole
            request, not just the stale event. If this is not cleared, those conversions are lost
            permanently. Check that the cron-job.org schedule is still running.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Tile label="Delivered" value={formatNumber(counts.delivered ?? 0)} tone="good" />
        <Tile label="Dry run" value={formatNumber(counts.skipped_dry_run ?? 0)} />
        <Tile label="Pending" value={formatNumber((counts.pending ?? 0) + (counts.in_flight ?? 0))} />
        <Tile label="Retrying" value={formatNumber(counts.failed_retryable ?? 0)} tone={(counts.failed_retryable ?? 0) > 0 ? "warn" : "default"} />
        <Tile label="Failed" value={formatNumber(counts.failed_permanent ?? 0)} tone={(counts.failed_permanent ?? 0) > 0 ? "danger" : "default"} />
        <Tile label="Withheld" value={formatNumber((counts.ineligible ?? 0) + (counts.expired ?? 0))} hint="gate + expired" />
      </div>

      <Card title="Destinations">
        {destinations.length === 0 ? (
          <div className="space-y-3 p-5">
            <EmptyState
              title="No destinations configured"
              hint="Create a disabled, dry-run destination in Settings, then add credentials and event mappings."
            />
            <div className="text-center">
              <Link href="/settings/integrations" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
                Configure Meta or Google →
              </Link>
            </div>
          </div>
        ) : (
          <DataTable>
            <thead className="border-b border-zinc-100 dark:border-zinc-800">
              <tr>
                <Th>Destination</Th>
                <Th>Status</Th>
                <Th>Last success</Th>
                <Th>Last error</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {destinations.map((d) => (
                <tr key={d.id}>
                  <Td>
                    <p className="font-medium">{d.name}</p>
                    <p className="text-xs text-zinc-500">{d.platform}</p>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${
                          d.isEnabled
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                        }`}
                      >
                        {d.isEnabled ? "Enabled" : "Disabled"}
                      </span>
                      {d.dryRun && (
                        <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                          Dry run
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td className="text-xs text-zinc-500">{formatRelative(d.lastSuccessAt)}</Td>
                  <Td className="max-w-[280px] truncate text-xs text-red-600 dark:text-red-400">
                    {d.lastError ?? "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>

      <Card title="Delivery log" subtitle="Most recent 60 attempts">
        {recent.length === 0 ? (
          <EmptyState
            title="Nothing queued yet"
            hint="Conversion events are created when leads change stage or a visit is checked in."
          />
        ) : (
          <DataTable>
            <thead className="border-b border-zinc-100 dark:border-zinc-800">
              <tr>
                <Th>Event</Th>
                <Th>Destination</Th>
                <Th>Status</Th>
                <Th className="text-right">Value</Th>
                <Th>Detail</Th>
                <Th className="text-right">When</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {recent.map((d) => (
                <tr key={d.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <Td>
                    <p className="font-medium capitalize">
                      {String(d.eventType).replace(/_/g, " ")}
                    </p>
                    {d.leadId && (
                      <Link href={`/leads/${d.leadId}`} className="text-xs text-zinc-500 hover:underline">
                        {d.leadReference}
                      </Link>
                    )}
                  </Td>
                  <Td className="text-xs text-zinc-500">{d.destinationName}</Td>
                  <Td>
                    <span
                      className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${
                        STATUS_CLASS[d.status] ?? "bg-zinc-100 text-zinc-600"
                      }`}
                    >
                      {String(d.status).replace(/_/g, " ")}
                    </span>
                    {d.attemptCount > 1 && (
                      <span className="tabular ml-1.5 text-xs text-zinc-400">×{d.attemptCount}</span>
                    )}
                  </Td>
                  <Td className="tabular text-right">{d.value ? formatINR(d.value, true) : "—"}</Td>
                  <Td className="max-w-[260px] truncate text-xs text-zinc-500">
                    {d.ineligibleReason
                      ? String(d.ineligibleReason).replace(/_/g, " ")
                      : (d.lastError ?? "—")}
                  </Td>
                  <Td className="text-right text-xs text-zinc-500">
                    {formatRelative(d.deliveredAt ?? d.updatedAt)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>
    </div>
  );
}

function Tile({
  label,
  value,
  tone = "default",
  hint,
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "warn" | "danger";
  hint?: string;
}) {
  const cls = {
    default: "",
    good: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400",
    danger: "text-red-600 dark:text-red-400",
  }[tone];
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`tabular mt-1.5 text-xl font-semibold ${cls}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-zinc-400">{hint}</p>}
    </div>
  );
}
