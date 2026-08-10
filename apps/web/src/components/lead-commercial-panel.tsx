import { addUnitToShortlist, recordNegotiationOffer, removeUnitFromShortlist } from "@/lib/lead-commercial-actions";
import { getLeadCommercialPanel } from "@/lib/lead-commercial-queries";
import { formatDateTime, formatINR } from "@/lib/format";
import { Card, SubmitButton } from "@/components/ui";

const fieldClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950";

/**
 * The shared `EmptyState` reserves `py-14` for a full-page void. In a side-by-side
 * panel whose whole job is to sit above a short form, that reads as a layout
 * bug rather than as breathing room.
 */
function PanelEmpty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="px-5 py-6 text-center">
      <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{title}</p>
      <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>
    </div>
  );
}

export async function LeadCommercialPanel({ orgId, leadId, writable }: { orgId: string; leadId: string; writable: boolean }) {
  const data = await getLeadCommercialPanel(orgId, leadId);
  if (!data || !data.lead.projectId) return null;
  return (
    // A fragment, not a grid: these two join the lead page's masonry so they
    // flow into whatever column has room, instead of forming a third band with
    // its own private alignment problem.
    <>
      <Card title="Unit shortlist" subtitle={data.lead.projectName ?? "Opportunity project"}>
        {data.shortlist.length === 0 ? <PanelEmpty title="No units shortlisted" hint="Shortlist the units this buyer actually reacted to." /> : <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">{data.shortlist.map((unit) => <li key={unit.id} className="flex items-center justify-between gap-3 px-5 py-3"><div><p className="text-sm font-semibold">{[unit.tower, unit.unitNumber].filter(Boolean).join(" · ")}</p><p className="text-xs text-zinc-500">{unit.configuration} · {formatINR(unit.allInPrice, true)} · {unit.status.replace(/_/g, " ")}</p>{unit.notes && <p className="mt-1 text-xs text-zinc-500">{unit.notes}</p>}</div>{writable && <form action={removeUnitFromShortlist}><input type="hidden" name="leadId" value={leadId} /><input type="hidden" name="interestId" value={unit.id} /><SubmitButton variant="secondary">Remove</SubmitButton></form>}</li>)}</ul>}
        {writable && data.available.length > 0 && <form action={addUnitToShortlist} className="space-y-2 border-t border-zinc-100 p-5 dark:border-zinc-800"><input type="hidden" name="leadId" value={leadId} /><select name="unitId" required className={fieldClass}><option value="">Choose available unit…</option>{data.available.map((unit) => <option key={unit.id} value={unit.id}>{[unit.tower, unit.unitNumber].filter(Boolean).join(" · ")} · {unit.configuration} · {formatINR(unit.allInPrice, true)}</option>)}</select><input name="notes" maxLength={500} placeholder="Why this unit fits…" className={fieldClass} /><SubmitButton className="w-full">Add to shortlist</SubmitButton></form>}
      </Card>

      <Card title="Negotiation ledger" subtitle="Append-only commercial offers; acceptance does not create a booking">
        {data.offers.length === 0 ? <PanelEmpty title="No offers recorded" hint="Every counter-offer, in the order it happened." /> : <ul className="max-h-72 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">{data.offers.map((offer) => { const meta = offer.metadata ?? {}; return <li key={offer.id} className="px-5 py-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold capitalize">{String(meta.side ?? "offer")} · {formatINR(String(meta.amount ?? ""), true)}</p><span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{String(meta.status ?? "open")}</span></div>{offer.body && <p className="mt-1 text-xs text-zinc-500">{offer.body}</p>}<p className="mt-1 text-[10px] text-zinc-400">{offer.userName ?? "User"} · {formatDateTime(offer.occurredAt)}</p></li>; })}</ul>}
        {writable && <form action={recordNegotiationOffer} className="space-y-2 border-t border-zinc-100 p-5 dark:border-zinc-800"><input type="hidden" name="leadId" value={leadId} /><div className="grid grid-cols-2 gap-2"><select name="side" className={fieldClass}><option value="customer">Customer offer</option><option value="company">Company offer</option></select><select name="status" className={fieldClass}><option value="open">Open</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option><option value="withdrawn">Withdrawn</option></select></div><select name="unitId" className={fieldClass}><option value="">No unit specified</option>{data.shortlist.map((unit) => <option key={unit.unitId} value={unit.unitId}>{[unit.tower, unit.unitNumber].filter(Boolean).join(" · ")}</option>)}</select><input name="amount" type="number" min="0.01" step="0.01" required placeholder="Offer amount (INR)" className={fieldClass} /><textarea name="terms" maxLength={2000} rows={2} placeholder="Payment plan, inclusions, validity…" className={fieldClass} /><SubmitButton className="w-full">Record offer</SubmitButton></form>}
      </Card>
    </>
  );
}
