"use client";

import { useMemo, useState } from "react";
import { EmptyState, SubmitButton } from "@/components/ui";
import { createBookingAction } from "@/lib/commercial-actions";
import type { CommercialLeadOption, InventoryRow } from "@/lib/commercial-queries";
import { formatINR } from "@/lib/format";

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:disabled:bg-zinc-900";

function unitMatchesLead(unit: InventoryRow, lead: CommercialLeadOption) {
  return Boolean(
    lead.projectId &&
      unit.projectId === lead.projectId &&
      (unit.status === "available" ||
        (unit.status === "held" && unit.heldForLeadId === lead.id)),
  );
}

export function BookingCreateForm({
  leads,
  units,
}: {
  leads: CommercialLeadOption[];
  units: InventoryRow[];
}) {
  const eligibleLeads = useMemo(
    () => leads.filter((lead) => units.some((unit) => unitMatchesLead(unit, lead))),
    [leads, units],
  );
  const [leadId, setLeadId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [initialStatus, setInitialStatus] = useState<"token" | "booked">("token");
  const lead = eligibleLeads.find((option) => option.id === leadId);
  const eligibleUnits = lead ? units.filter((unit) => unitMatchesLead(unit, lead)) : [];
  const bookingConfirmed = initialStatus === "booked";

  if (eligibleLeads.length === 0) {
    return (
      <EmptyState
        title="No compatible lead and unit are available"
        hint="Assign an open lead to a project, then make a unit available or hold it for that lead."
      />
    );
  }

  return (
    <form action={createBookingAction} className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
      <label className="block lg:col-span-2">
        <span className="mb-1 block text-xs text-zinc-500">Lead *</span>
        <select
          name="leadId"
          value={leadId}
          required
          className={inputClass}
          onChange={(event) => {
            setLeadId(event.target.value);
            setUnitId("");
          }}
        >
          <option value="">Select buyer / lead</option>
          {eligibleLeads.map((option) => (
            <option key={option.id} value={option.id}>
              {option.reference} · {option.fullName ?? option.primaryPhone ?? "Unnamed"} · {option.projectName}
            </option>
          ))}
        </select>
      </label>

      <label className="block lg:col-span-2">
        <span className="mb-1 block text-xs text-zinc-500">Unit *</span>
        <select
          name="unitId"
          value={unitId}
          required
          disabled={!lead}
          className={inputClass}
          onChange={(event) => setUnitId(event.target.value)}
        >
          <option value="">
            {lead ? "Select an eligible unit" : "Select a lead first"}
          </option>
          {eligibleUnits.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.projectName} · {unit.tower ? `${unit.tower} · ` : ""}
              {unit.unitNumber} · {unit.configuration} · {formatINR(unit.allInPrice, true)}
              {unit.status === "held" ? " · HELD FOR THIS LEAD" : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs text-zinc-500">Register as *</span>
        <select
          name="initialStatus"
          value={initialStatus}
          className={inputClass}
          onChange={(event) => setInitialStatus(event.target.value as "token" | "booked")}
        >
          <option value="token">Token received</option>
          <option value="booked">Booking confirmed</option>
        </select>
      </label>

      <Field label="Token amount *" name="tokenAmount" type="number" min="0.01" step="0.01" required />
      <Field
        label={`Agreement value${bookingConfirmed ? " *" : ""}`}
        name="agreementValue"
        type="number"
        min="0.01"
        step="0.01"
        required={bookingConfirmed}
      />

      <label className="block">
        <span className="mb-1 block text-xs text-zinc-500">Payment mode *</span>
        <select name="paymentMode" defaultValue="neft" className={inputClass}>
          <option value="upi">UPI</option>
          <option value="neft">NEFT / RTGS</option>
          <option value="cheque">Cheque</option>
          <option value="card">Card</option>
          <option value="cash">Cash</option>
          <option value="other">Other</option>
        </select>
      </label>

      <Field label="Payment reference" name="paymentReference" placeholder="UTR / cheque number" />
      <Field label="Received at" name="receivedAt" type="datetime-local" />
      <div className="flex items-end sm:col-span-2">
        <SubmitButton className="w-full">Create commercial record</SubmitButton>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  ...props
}: {
  label: string;
  name: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-zinc-500">{label}</span>
      <input name={name} {...props} className={inputClass} />
    </label>
  );
}
