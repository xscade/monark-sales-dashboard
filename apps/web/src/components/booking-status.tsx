import { Check, CircleAlert, Clock3 } from "lucide-react";
import {
  VERIFICATION_LABELS,
  verificationDrifted,
  type VerificationStatus,
  type VerificationView,
} from "@/lib/verification";

const statusClass: Record<string, string> = {
  token: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300",
  booked: "bg-green-600 text-white",
  agreement_signed: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  registered: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

/** The sales milestone. Lives here so every screen spells it the same way. */
export function BookingStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${statusClass[status] ?? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

/**
 * The finance mark that sits beside the sales status.
 *
 * Only a confirmed match earns the tick. "Awaiting verification" renders as
 * plain, quiet text on purpose — an amber warning on every fresh booking would
 * train people to ignore the colour, and a booking nobody has got to yet is not
 * a problem, it is just Tuesday.
 */
export function VerificationBadge({
  view,
  showPending = false,
  className = "",
}: {
  view: VerificationView;
  /** Show a marker while a decision is still outstanding. */
  showPending?: boolean;
  className?: string;
}) {
  const status = view.verificationStatus as VerificationStatus;
  const drifted = verificationDrifted(view);

  if (status === "pending") {
    if (!showPending) return null;
    return (
      <span
        title={VERIFICATION_LABELS.pending}
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 ${className}`}
      >
        <Clock3 className="size-3" />
        Unverified
      </span>
    );
  }

  if (status === "no_match") {
    return (
      <span
        title="Accounts could not match this amount against the bank"
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950 dark:text-red-300 ${className}`}
      >
        <CircleAlert className="size-3" />
        No match
      </span>
    );
  }

  return (
    <span
      title={
        drifted
          ? "Validated, but money has been received since — back in the accounts queue"
          : "Amount confirmed against the bank by accounts"
      }
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
        drifted
          ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
      } ${className}`}
    >
      <Check className="size-3" strokeWidth={3} />
      {drifted ? "Validated · part" : "Validated"}
    </span>
  );
}

/** Sales milestone and finance mark together — the pairing used in tables. */
export function BookingStatus({
  status,
  view,
  showPending = false,
}: {
  status: string;
  view: VerificationView;
  showPending?: boolean;
}) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <BookingStatusBadge status={status} />
      <VerificationBadge view={view} showPending={showPending} />
    </span>
  );
}
