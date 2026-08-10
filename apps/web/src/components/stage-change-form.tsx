"use client";

import { useState } from "react";
import { changeStage } from "@/lib/actions";
import { SubmitButton } from "@/components/ui";
import { stageLabel } from "@/lib/format";
import { TERMINAL_STAGES } from "@monark/core/pipeline";

const field =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950";

const CLOSING_REASONS = [
  ["not_interested", "Not interested"],
  ["budget_mismatch", "Budget mismatch"],
  ["location_mismatch", "Location mismatch"],
  ["configuration_mismatch", "Configuration mismatch"],
  ["possession_timeline_mismatch", "Possession timeline mismatch"],
  ["postponed", "Postponed"],
  ["no_response", "No response"],
  ["bought_competitor", "Bought from competitor"],
  ["invalid_contact", "Invalid contact"],
  ["duplicate", "Duplicate"],
  ["spam_or_bot", "Spam or bot"],
  ["wrong_geography", "Wrong geography"],
  ["agent_or_broker", "Agent or broker"],
] as const;

/**
 * Stage dropdown on the lead page.
 *
 * Disqualified needs the same do-not-contact checkbox the dedicated Disqualify
 * button uses — otherwise the two paths diverge and Customers suppression
 * becomes a coin flip depending on which control the agent clicked.
 */
export function StageChangeForm({
  leadId,
  currentStage,
}: {
  leadId: string;
  currentStage: string;
}) {
  const [toStage, setToStage] = useState("");
  const closing = toStage === "lost" || toStage === "disqualified";

  return (
    <form action={changeStage} className="space-y-3 p-5">
      <input type="hidden" name="leadId" value={leadId} />
      <select
        name="toStage"
        value={toStage}
        onChange={(event) => setToStage(event.target.value)}
        required
        className={field}
      >
        <option value="" disabled>
          Select stage…
        </option>
        {["new", "contacted", "qualified", "negotiating", ...TERMINAL_STAGES]
          .filter((stage) => stage !== currentStage)
          .map((stage) => (
            <option key={stage} value={stage}>
              {stageLabel(stage)}
            </option>
          ))}
      </select>
      <select name="reasonCode" defaultValue="" required={closing} className={field}>
        <option value="">
          {closing ? "Closing reason *" : "Closing reason (required for Lost / Disqualified)…"}
        </option>
        {CLOSING_REASONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <input
        name="reason"
        required={closing}
        placeholder="Reason (required when moving backwards or closing)"
        className={field}
      />
      {toStage === "disqualified" && (
        <label className="flex items-start gap-2.5 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <input type="checkbox" name="doNotContact" className="mt-0.5 size-4 accent-red-600" />
          <span>
            <span className="block text-sm font-medium">Mark do not contact</span>
            <span className="block text-xs text-zinc-500">
              Applies to the person across every enquiry — the same flag Customers uses.
            </span>
          </span>
        </label>
      )}
      <SubmitButton>Update stage</SubmitButton>
      <p className="text-xs text-zinc-500">
        Visits, token payments and bookings are advanced by their dedicated workflows so reporting stays auditable.
      </p>
    </form>
  );
}
