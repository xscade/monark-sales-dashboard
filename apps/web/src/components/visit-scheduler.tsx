"use client";

import { useActionState } from "react";
import { AlertCircle, CalendarPlus, CheckCircle2 } from "lucide-react";
import { scheduleVisit, type VisitActionState } from "@/lib/visit-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function VisitScheduler({
  leads,
  hosts,
  currentUserId,
}: {
  leads: { id: string; reference: string; name: string | null; phone: string | null; projectName: string | null }[];
  hosts: { id: string; name: string; role: string }[];
  currentUserId: string;
}) {
  const [state, action, pending] = useActionState<VisitActionState, FormData>(scheduleVisit, { ok: false });
  const defaultHost = hosts.some((host) => host.id === currentUserId) ? currentUserId : hosts[0]?.id;

  return (
    <form action={action} className="space-y-4">
      {state.message && <Alert variant={state.ok ? "default" : "destructive"}>{state.ok ? <CheckCircle2 /> : <AlertCircle />}<AlertDescription>{state.message}</AlertDescription></Alert>}
      <div className="space-y-1.5"><Label htmlFor="visit-lead">Lead</Label><select id="visit-lead" name="leadId" required className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Select a lead…</option>{leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.name ?? "Unnamed"} · {lead.phone ?? lead.reference}{lead.projectName ? ` · ${lead.projectName}` : ""}</option>)}</select></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="visit-type">Visit type</Label><select id="visit-type" name="type" defaultValue="project_site" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="project_site">Project site</option><option value="corporate_office">Corporate office</option><option value="experience_centre">Experience centre</option><option value="virtual">Virtual tour</option></select></div>
        <div className="space-y-1.5"><Label htmlFor="visit-at">Date & time</Label><input id="visit-at" name="scheduledAt" type="datetime-local" required className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" /></div>
        <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="visit-host">Host</Label><select id="visit-host" name="hostUserId" defaultValue={defaultHost} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">{hosts.map((host) => <option key={host.id} value={host.id}>{host.name} · {host.role.replace(/_/g, " ")}</option>)}</select></div>
      </div>
      <div className="space-y-1.5"><Label htmlFor="visit-notes">Notes</Label><Textarea id="visit-notes" name="notes" placeholder="Configuration to show, transport, family context…" /></div>
      <Button type="submit" disabled={pending || leads.length === 0} className="w-full"><CalendarPlus />{pending ? "Scheduling…" : "Schedule visit"}</Button>
    </form>
  );
}
