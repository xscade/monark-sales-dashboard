"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, Ban, CheckCircle2 } from "lucide-react";
import { disqualifyLead, promoteLead, type LeadActionState } from "@/lib/actions";
import { LOST_REASONS, isEditableStage, nextForwardStage } from "@/lib/stage-edit";
import { stageLabel } from "@/lib/format";

const initialState: LeadActionState = { ok: false };
const field =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-700 dark:bg-zinc-950";

const REASON_LABELS: Record<string, string> = {
  not_interested: "Not interested",
  budget_mismatch: "Budget mismatch",
  location_mismatch: "Location mismatch",
  configuration_mismatch: "Configuration mismatch",
  possession_timeline_mismatch: "Possession timeline mismatch",
  postponed: "Postponed",
  no_response: "No response",
  bought_competitor: "Bought from competitor",
  invalid_contact: "Invalid contact",
  duplicate: "Duplicate",
  spam_or_bot: "Spam or bot",
  wrong_geography: "Wrong geography",
  agent_or_broker: "Agent or broker",
};

/**
 * Promote and Disqualify, wherever a lead is listed.
 *
 * Both call the same server actions the lead page uses, so a disqualification
 * from the customer table and one from the stage dropdown produce an identical
 * record — same structured reason, same history row, same suppression.
 */
export function LeadActions({
  leadId,
  leadName,
  stage,
  showPromote = false,
  compact = false,
}: {
  leadId: string;
  leadName: string;
  stage: string;
  showPromote?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const next = nextForwardStage(stage);
  const closed = stage === "lost" || stage === "disqualified";
  const size = compact ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showPromote && next && !closed && (
        <PromoteButton leadId={leadId} next={next} size={size} />
      )}

      {!closed && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`flex items-center gap-1.5 rounded-lg border border-red-300 font-medium text-red-600 transition hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40 ${size}`}
        >
          <Ban aria-hidden className="size-3.5" />
          Disqualify
        </button>
      )}

      {open && (
        <DisqualifyDialog
          leadId={leadId}
          leadName={leadName}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function PromoteButton({
  leadId,
  next,
  size,
}: {
  leadId: string;
  next: string;
  size: string;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(promoteLead, initialState);
  // Visits, token payments and bookings need evidence this button cannot
  // collect, so for those the label stays honest and sends them to the lead.
  const settable = isEditableStage(next);

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  if (!settable) {
    return (
      <Link
        href={`/leads/${leadId}`}
        className={`flex items-center gap-1.5 rounded-lg border border-zinc-300 font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800 ${size}`}
        title={`${stageLabel(next)} needs its own workflow — open the lead to record it`}
      >
        <ArrowRight aria-hidden className="size-3.5" />
        Promote to {stageLabel(next)}
      </Link>
    );
  }

  return (
    <form action={action} className="contents">
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="toStage" value={next} />
      <button
        type="submit"
        disabled={pending}
        title={state.message}
        className={`flex items-center gap-1.5 rounded-lg bg-brand-600 font-medium text-white transition hover:bg-brand-700 disabled:opacity-50 ${size}`}
      >
        <ArrowRight aria-hidden className="size-3.5" />
        {pending ? "Moving…" : `Promote to ${stageLabel(next)}`}
      </button>
    </form>
  );
}

function DisqualifyDialog({
  leadId,
  leadName,
  onClose,
}: {
  leadId: string;
  leadName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(disqualifyLead, initialState);

  useEffect(() => {
    if (state.ok) {
      onClose();
      router.refresh();
    }
  }, [state.ok, onClose, router]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="disqualify-title"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        action={action}
        className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 text-left shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
      >
        <input type="hidden" name="leadId" value={leadId} />
        <h2 id="disqualify-title" className="text-sm font-semibold">
          Disqualify {leadName}
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          The reason is not paperwork — it trains campaign quality reporting and stops the ad
          platforms optimising for more enquiries like this one.
        </p>

        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-medium text-zinc-500">Reason *</span>
          <select name="reasonCode" required defaultValue="" className={field}>
            <option value="" disabled>Choose a reason…</option>
            {LOST_REASONS.map((code) => (
              <option key={code} value={code}>{REASON_LABELS[code] ?? code}</option>
            ))}
          </select>
        </label>

        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-medium text-zinc-500">What happened? *</span>
          <textarea
            name="reason"
            required
            minLength={3}
            maxLength={500}
            rows={2}
            placeholder="Bought elsewhere last month, asked us not to call again…"
            className={field}
          />
        </label>

        <label className="mt-3 flex items-start gap-2.5 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <input type="checkbox" name="doNotContact" className="mt-0.5 size-4 accent-red-600" />
          <span>
            <span className="block text-sm font-medium">Mark do not contact</span>
            <span className="block text-xs text-zinc-500">
              Applies to the person, so every enquiry they have ever made is suppressed —
              including any opened from Customers.
            </span>
          </span>
        </label>

        {state.message && !state.ok && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
            <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {state.message}
          </p>
        )}
        {state.ok && state.message && (
          <p className="mt-3 flex items-start gap-2 text-xs text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {state.message}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
          >
            {pending ? "Disqualifying…" : "Disqualify"}
          </button>
        </div>
      </form>
    </div>
  );
}
