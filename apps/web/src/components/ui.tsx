import Link from "next/link";
import { STAGE_CLASS, stageLabel } from "@/lib/format";

export function Card({
  children,
  className = "",
  title,
  subtitle,
  action,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-3.5 dark:border-zinc-800">
          <div>
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function StageBadge({ stage }: { stage: string }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${
        STAGE_CLASS[stage] ?? "bg-zinc-100 text-zinc-600"
      }`}
    >
      {stageLabel(stage)}
    </span>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = "default",
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "warn" | "danger" | "good";
  href?: string;
}) {
  const toneClass = {
    default: "text-zinc-900 dark:text-zinc-100",
    good: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400",
    danger: "text-red-600 dark:text-red-400",
  }[tone];

  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`tabular mt-1.5 text-2xl font-semibold ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </>
  );

  const className =
    "block rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900" +
    (href ? " transition hover:border-brand-400" : "");

  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-5 py-14 text-center">
      <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

export function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-middle text-sm ${className}`}>{children}</td>;
}

export function DataTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse">{children}</table>
    </div>
  );
}

/**
 * Countdown to Google's 90-day GCLID expiry.
 *
 * Surfaced next to leads because it is genuinely actionable: once this hits
 * zero, no conversion for that lead can ever be attributed to the click that
 * produced it. A site visit logged on day 88 still teaches Google something; on
 * day 91 it teaches it nothing.
 */
export function AttributionClock({ expiresAt }: { expiresAt: Date | string | null }) {
  if (!expiresAt) return <span className="text-xs text-zinc-400">—</span>;

  const date = typeof expiresAt === "string" ? new Date(expiresAt) : expiresAt;
  const days = Math.floor((date.getTime() - Date.now()) / 86_400_000);

  if (days <= 0) {
    return (
      <span className="whitespace-nowrap rounded-md bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
        Window closed
      </span>
    );
  }
  if (days <= 14) {
    return (
      <span className="whitespace-nowrap rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
        {days}d left
      </span>
    );
  }
  return <span className="tabular whitespace-nowrap text-xs text-zinc-500">{days}d left</span>;
}

export function SourceBadge({ source, platform }: { source: string; platform?: string | null }) {
  const label = platform ?? source;
  const cls =
    platform === "google"
      ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
      : platform === "meta"
        ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
  return (
    <span className={`inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${cls}`}>
      {label.replace(/_/g, " ")}
    </span>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  className = "",
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
}) {
  const variants = {
    primary: "bg-brand-600 text-white hover:bg-brand-700",
    secondary:
      "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800",
    danger: "bg-red-600 text-white hover:bg-red-700",
  };
  return (
    <button
      type="submit"
      className={`rounded-lg px-3 py-2 text-sm font-medium transition ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
