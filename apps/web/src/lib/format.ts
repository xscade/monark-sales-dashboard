import type { LeadStage } from "@monark/core";

/**
 * Indian numbering for money.
 *
 * ₹3,20,00,000 rather than ₹32,000,000 — this is read all day by people who
 * think in lakhs and crores, and Western grouping makes them stop and count
 * digits.
 */
export function formatINR(value: number | string | null | undefined, compact = false): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";

  if (compact) {
    if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2).replace(/\.00$/, "")} Cr`;
    if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2).replace(/\.00$/, "")} L`;
  }
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatNumber(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "—";
  const v = typeof n === "string" ? Number(n) : n;
  return Number.isFinite(v) ? new Intl.NumberFormat("en-IN").format(v) : "—";
}

export function formatPercent(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

const IST = "Asia/Kolkata";

export function formatDateTime(d: Date | string | null | undefined, tz = IST): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: tz,
  }).format(date);
}

export function formatDate(d: Date | string | null | undefined, tz = IST): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: tz }).format(date);
}

/** "19 days ago", "in 3 days". Relative time is what sales actually reason in. */
export function formatRelative(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";

  const diffMs = date.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000_000],
    ["month", 2_592_000_000],
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(Math.round(diffMs / ms), unit);
  }
  return "just now";
}

/** Response-time colouring. Speed-to-lead is the strongest single predictor of
 *  conversion in real estate, so it gets emphasised rather than buried. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

export const STAGE_LABEL: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  visit_scheduled: "Visit Scheduled",
  visited: "Visited",
  negotiating: "Negotiating",
  token_paid: "Token Paid",
  booked: "Booked",
  lost: "Lost",
  disqualified: "Disqualified",
};

export const STAGE_CLASS: Record<string, string> = {
  new: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  contacted: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  qualified: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300",
  visit_scheduled: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  visited: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  negotiating: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  token_paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  booked: "bg-green-600 text-white",
  lost: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  disqualified: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export function stageLabel(stage: string): string {
  return STAGE_LABEL[stage] ?? stage;
}

/** Mask a phone for list views. Full numbers appear only on the detail page,
 *  which limits how much PII a shoulder-surfer picks up from a shared screen. */
export function maskPhoneDisplay(phone: string | null | undefined): string {
  if (!phone) return "—";
  if (phone.length < 6) return phone;
  return `${phone.slice(0, 6)}•••${phone.slice(-3)}`;
}

export type { LeadStage };
