"use client";

import { useId, useMemo, useRef, useState } from "react";
import { BadgeIndianRupee, ChevronRight, Search, Trash2 } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  deleteUnitAction,
  holdUnitAction,
  releaseUnitHoldAction,
  setUnitStatusAction,
  updateUnitAction,
} from "@/lib/commercial-actions";
import { cn } from "@/lib/utils";

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-700 dark:bg-zinc-950";
const compactClass = `${inputClass} py-1.5 text-xs`;

export interface ManageableUnit {
  id: string;
  tower: string | null;
  unitNumber: string;
  floor: number | null;
  configuration: string;
  carpetAreaSqft: string | null;
  saleableAreaSqft: string | null;
  facing: string | null;
  basePrice: string | null;
  allInPrice: string | null;
  status: string;
  holdId: string | null;
}

export interface HoldableLead {
  id: string;
  reference: string;
  fullName: string | null;
  primaryPhone: string | null;
}

export function UnitManagePanel({
  unit,
  leads,
}: {
  unit: ManageableUnit;
  leads: HoldableLead[];
}) {
  const [open, setOpen] = useState(false);
  const canChangeAvailability = !unit.holdId && unit.status !== "token_paid" &&
    unit.status !== "booked" && unit.status !== "registered";

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 text-sm font-medium text-brand-600 outline-none focus-visible:underline">
        <ChevronRight
          aria-hidden
          className={cn("size-4 transition-transform duration-200", open && "rotate-90")}
        />
        Manage
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="mt-3 space-y-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
          <form action={updateUnitAction} className="grid gap-2 sm:grid-cols-2">
            <input type="hidden" name="unitId" value={unit.id} />
            <Field label="Tower" name="tower" defaultValue={unit.tower ?? ""} />
            <Field label="Unit" name="unitNumber" defaultValue={unit.unitNumber} required />
            <Field label="Floor" name="floor" type="number" defaultValue={unit.floor ?? ""} />
            <Field label="Configuration" name="configuration" defaultValue={unit.configuration} required />
            <Field label="Carpet sq ft" name="carpetAreaSqft" type="number" step="0.01" defaultValue={unit.carpetAreaSqft ?? ""} />
            <Field label="Saleable sq ft" name="saleableAreaSqft" type="number" step="0.01" defaultValue={unit.saleableAreaSqft ?? ""} />
            <Field label="Facing" name="facing" defaultValue={unit.facing ?? ""} />
            <Field label="Base price" name="basePrice" type="number" step="0.01" defaultValue={unit.basePrice ?? ""} />
            <Field label="All-in price" name="allInPrice" type="number" step="0.01" defaultValue={unit.allInPrice ?? ""} />
            <div className="flex items-end">
              <button
                type="submit"
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Save unit
              </button>
            </div>
          </form>

          {canChangeAvailability && (
            <form action={setUnitStatusAction} className="flex items-end gap-2">
              <input type="hidden" name="unitId" value={unit.id} />
              <label className="min-w-0 flex-1">
                <span className="mb-1 block text-xs text-zinc-500">Availability</span>
                <select name="status" defaultValue={unit.status} className={inputClass}>
                  <option value="available">Available</option>
                  <option value="blocked">Blocked</option>
                  <option value="sold">Sold</option>
                </select>
              </label>
              <button
                type="submit"
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Update
              </button>
            </form>
          )}

          {unit.holdId ? (
            <form action={releaseUnitHoldAction} className="space-y-2">
              <input type="hidden" name="holdId" value={unit.holdId} />
              <input name="releaseReason" required defaultValue="Released manually" className={inputClass} />
              <button
                type="submit"
                className="w-full rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-700"
              >
                Release hold
              </button>
            </form>
          ) : (
            unit.status === "available" && (
              <>
                {/* Above the hold form on purpose: marking a unit sold is the
                    decisive action, and a hold is the reversible one. */}
                <form action={setUnitStatusAction}>
                  <input type="hidden" name="unitId" value={unit.id} />
                  <input type="hidden" name="status" value="sold" />
                  <button
                    type="submit"
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                  >
                    <BadgeIndianRupee className="size-4" />
                    Mark as sold
                  </button>
                  <p className="mt-1 text-[11px] leading-snug text-zinc-500">
                    For stock sold outside the CRM. A unit with a booking is advanced from the
                    booking register instead.
                  </p>
                </form>

                <form action={holdUnitAction} className="space-y-2">
                  <input type="hidden" name="unitId" value={unit.id} />
                  <LeadPicker leads={leads} />
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Hours" name="hours" type="number" defaultValue={48} required />
                    <Field label="Reason" name="reason" placeholder="Price discussion" />
                  </div>
                  <button
                    type="submit"
                    className="w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
                  >
                    Place hold
                  </button>
                </form>
              </>
            )
          )}

          <form
            action={deleteUnitAction}
            className="border-t border-zinc-200 pt-3 dark:border-zinc-700"
            onSubmit={(event) => {
              if (
                !window.confirm(
                  `Delete unit ${unit.tower ? `${unit.tower} · ` : ""}${unit.unitNumber}? This cannot be undone.`,
                )
              ) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="unitId" value={unit.id} />
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              <Trash2 className="size-3.5" />
              Delete unit
            </button>
          </form>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Ranks a lead against what has been typed so far.
 *
 * A dropdown of 300 leads is unusable at a desk, and a plain substring filter
 * is barely better: staff type a half-remembered surname or the last four
 * digits of a phone number, and the option they want has to surface without an
 * exact match. Higher score sorts first; 0 means "do not show".
 */
function score(lead: HoldableLead, query: string): number {
  if (!query) return 1;
  const needle = query.trim().toLowerCase();
  const digits = needle.replace(/\D/g, "");
  const haystacks = [
    { text: (lead.fullName ?? "").toLowerCase(), weight: 3 },
    { text: lead.reference.toLowerCase(), weight: 2 },
    { text: (lead.primaryPhone ?? "").toLowerCase(), weight: 2 },
  ];

  let best = 0;
  for (const { text, weight } of haystacks) {
    if (!text) continue;
    if (text === needle) best = Math.max(best, 1000 * weight);
    else if (text.startsWith(needle)) best = Math.max(best, 500 * weight);
    else {
      const at = text.indexOf(needle);
      // Word-start matches beat mid-word ones: "men" should rank "Rahul Menon"
      // above "Karthikeyan Menon" only when nothing better exists.
      if (at === 0) best = Math.max(best, 400 * weight);
      else if (at > 0) best = Math.max(best, (text[at - 1] === " " ? 300 : 200) * weight - at);
    }
  }

  // Phone typed with spaces or a country code still has to match the stored form.
  if (digits.length >= 3 && lead.primaryPhone) {
    const stored = lead.primaryPhone.replace(/\D/g, "");
    if (stored.endsWith(digits)) best = Math.max(best, 900);
    else if (stored.includes(digits)) best = Math.max(best, 600);
  }

  if (best) return best;

  // Last resort: characters appearing in order ("rmn" → "Rahul Menon").
  const name = (lead.fullName ?? "").toLowerCase();
  let cursor = 0;
  for (const char of needle) {
    const found = name.indexOf(char, cursor);
    if (found === -1) return 0;
    cursor = found + 1;
  }
  return 50;
}

function LeadPicker({ leads }: { leads: HoldableLead[] }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<HoldableLead | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const blurTimer = useRef<number | null>(null);

  const matches = useMemo(() => {
    return leads
      .map((lead) => ({ lead, rank: score(lead, query) }))
      .filter((entry) => entry.rank > 0)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 8)
      .map((entry) => entry.lead);
  }, [leads, query]);

  function choose(lead: HoldableLead) {
    setSelected(lead);
    setQuery(`${lead.fullName ?? lead.primaryPhone ?? "Unnamed"} · ${lead.reference}`);
    setOpen(false);
  }

  return (
    <label className="relative block">
      <span className="mb-1 block text-xs text-zinc-500">Hold for lead</span>
      <input type="hidden" name="leadId" value={selected?.id ?? ""} required />
      <span className="relative block">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400"
        />
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          value={query}
          placeholder="Search name, phone or reference…"
          className={`${inputClass} pl-8`}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(null);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Let a click on an option land before the list disappears.
            blurTimer.current = window.setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              setActive((current) => {
                const next = current + (event.key === "ArrowDown" ? 1 : -1);
                return Math.min(Math.max(next, 0), Math.max(matches.length - 1, 0));
              });
            } else if (event.key === "Enter" && open && matches[active]) {
              event.preventDefault();
              choose(matches[active]);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        />
      </span>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          onMouseDown={() => {
            if (blurTimer.current) window.clearTimeout(blurTimer.current);
          }}
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-xs text-zinc-500">
              {leads.length === 0 ? "No holdable leads on this project" : "No close matches"}
            </li>
          ) : (
            matches.map((lead, index) => (
              <li key={lead.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(lead)}
                  className={cn(
                    "block w-full px-3 py-1.5 text-left text-xs",
                    index === active && "bg-brand-50 dark:bg-brand-600/15",
                  )}
                >
                  <span className="block font-medium">{lead.fullName ?? "Unnamed"}</span>
                  <span className="tabular block text-zinc-500">
                    {lead.primaryPhone ?? "No phone"} · {lead.reference}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </label>
  );
}

function Field({
  label,
  name,
  ...props
}: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-zinc-500">{label}</span>
      <input name={name} {...props} className={compactClass} />
    </label>
  );
}
