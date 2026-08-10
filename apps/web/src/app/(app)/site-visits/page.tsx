import Link from "next/link";
import { CalendarCheck2, Check, CircleX, Clock3, MapPin, Plus, Search, UserRoundCheck, X } from "lucide-react";
import { requirePermission, can } from "@/lib/auth";
import { getVisitSchedulingOptions, listVisits, type VisitStatus } from "@/lib/visit-queries";
import { updateVisitStatus } from "@/lib/visit-actions";
import { VisitScheduler } from "@/components/visit-scheduler";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, maskPhoneDisplay } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const statusTone: Record<VisitStatus, string> = {
  scheduled: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  confirmed: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  arrived: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  no_show: "bg-red-500/10 text-red-700 dark:text-red-300",
  cancelled: "bg-muted text-muted-foreground",
};

export default async function SiteVisitsPage({ searchParams }: { searchParams: Promise<{ range?: string; status?: string; q?: string }> }) {
  const user = await requirePermission("visits:read");
  const params = await searchParams;
  const range = (["today", "upcoming", "past"].includes(params.range ?? "") ? params.range : "upcoming") as "today" | "upcoming" | "past";
  const status = (["scheduled", "confirmed", "arrived", "completed", "no_show", "cancelled"].includes(params.status ?? "") ? params.status : undefined) as VisitStatus | undefined;
  const search = params.q?.trim() ?? "";
  const writable = can(user, "visits:write");
  const personalUserId = user.role === "sales_agent" ? user.id : undefined;
  const [rows, options] = await Promise.all([
    listVisits(user.orgId, { range, status, userId: personalUserId, search }),
    writable ? getVisitSchedulingOptions(user.orgId, personalUserId) : Promise.resolve({ leads: [], hosts: [] }),
  ]);
  const buildHref = (next: { range?: string; q?: string }) => {
    const query = new URLSearchParams();
    query.set("range", next.range ?? range);
    if (status) query.set("status", status);
    const term = next.q ?? search;
    if (term) query.set("q", term);
    return `/site-visits?${query.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Field operations</p><p className="mt-1 text-sm text-muted-foreground">Appointments, arrivals, outcomes and no-shows—kept as separate facts.</p></div>{writable && <Button asChild variant="outline"><Link href="/walk-ins/new"><Plus />Fresh walk-in</Link></Button>}</div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">{(["today", "upcoming", "past"] as const).map((item) => <Button key={item} asChild size="sm" variant={range === item ? "default" : "outline"}><Link href={buildHref({ range: item })} className="capitalize">{item}</Link></Button>)}</div>
            <form method="get" action="/site-visits" className="flex items-center gap-2">
              <input type="hidden" name="range" value={range} />
              {status && <input type="hidden" name="status" value={status} />}
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input type="search" name="q" defaultValue={search} aria-label="Search visits by customer" placeholder="Customer name, phone or LD-reference" className="h-8 w-60 pl-8 text-sm sm:w-72" />
              </div>
              <Button size="sm" type="submit" variant="secondary">Search</Button>
              {search && <Button asChild size="sm" variant="ghost" className="text-muted-foreground"><Link href={buildHref({ q: "" })}><X />Clear</Link></Button>}
            </form>
          </div>
          {search && rows.length > 0 && <p className="text-xs text-muted-foreground">{rows.length} {rows.length === 1 ? "visit" : "visits"} matching “{search}”</p>}
          {rows.length === 0 ? <Card><CardContent className="flex min-h-64 flex-col items-center justify-center text-center"><CalendarCheck2 className="size-8 text-muted-foreground/55" /><p className="mt-3 text-sm font-semibold">{search ? `No visits match “${search}”` : "No visits in this view"}</p><p className="mt-1 text-xs text-muted-foreground">{search ? "Try a phone number or LD-reference, or clear the search to see every visit in this view." : "Schedule the next appointment or change the date filter."}</p></CardContent></Card> : rows.map((visit) => (
            <Card key={visit.id} className="gap-0 py-0 shadow-sm">
              <CardContent className="p-4 sm:p-5">
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Link href={`/leads/${visit.leadId}`} className="truncate font-bold hover:text-primary">{visit.customerName ?? "Unnamed visitor"}</Link><Badge className={cn("border-0 capitalize", statusTone[visit.status])}>{visit.status.replace(/_/g, " ")}</Badge></div><p className="tabular mt-1 text-xs text-muted-foreground">{maskPhoneDisplay(visit.phone)} · {visit.leadReference}</p><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><Clock3 className="size-3.5" />{visit.scheduledAt ? formatDateTime(visit.scheduledAt) : "Unscheduled"}</span><span className="flex items-center gap-1.5"><MapPin className="size-3.5" />{visit.type.replace(/_/g, " ")}{visit.projectName ? ` · ${visit.projectName}` : ""}</span>{visit.hostName && <span className="flex items-center gap-1.5"><UserRoundCheck className="size-3.5" />{visit.hostName}</span>}</div>{visit.notes && <p className="mt-3 text-sm text-muted-foreground">{visit.notes}</p>}{(visit.intentRating || visit.nextAction || visit.configurationsViewed?.length || visit.unitsViewed?.length || visit.objections?.length) && <div className="mt-3 flex flex-wrap gap-1.5 text-xs">{visit.intentRating && <Badge variant="secondary">Intent {visit.intentRating}/5</Badge>}{visit.configurationsViewed?.map((item) => <Badge key={`configuration-${item}`} variant="outline">{item}</Badge>)}{visit.unitsViewed?.map((item) => <Badge key={`unit-${item}`} variant="outline">{item}</Badge>)}{visit.objections?.length ? <span className="basis-full text-muted-foreground">Objections: {visit.objections.join(", ")}</span> : null}{visit.nextAction && <span className="basis-full font-medium text-foreground">Next: {visit.nextAction}</span>}</div>}</div>
                  {writable && ["scheduled", "confirmed", "arrived"].includes(visit.status) && <div className="flex shrink-0 flex-wrap gap-2">{visit.status === "scheduled" && <form action={updateVisitStatus}><input type="hidden" name="visitId" value={visit.id} /><input type="hidden" name="status" value="confirmed" /><Button size="sm" variant="outline"><Check />Confirm</Button></form>}{["scheduled", "confirmed"].includes(visit.status) && <form action={updateVisitStatus}><input type="hidden" name="visitId" value={visit.id} /><input type="hidden" name="status" value="arrived" /><Button size="sm"><MapPin />Arrived</Button></form>}{visit.status === "arrived" && <form action={updateVisitStatus}><input type="hidden" name="visitId" value={visit.id} /><input type="hidden" name="status" value="completed" /><Button size="sm"><Check />Complete</Button></form>} {["scheduled", "confirmed"].includes(visit.status) && <form action={updateVisitStatus}><input type="hidden" name="visitId" value={visit.id} /><input type="hidden" name="status" value="no_show" /><Button size="sm" variant="ghost" className="text-destructive"><CircleX />No-show</Button></form>}<form action={updateVisitStatus}><input type="hidden" name="visitId" value={visit.id} /><input type="hidden" name="status" value="cancelled" /><Button size="sm" variant="ghost" className="text-muted-foreground"><CircleX />Cancel</Button></form></div>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        {writable && <Card className="sticky top-24 h-fit gap-0 py-0 shadow-sm"><CardHeader className="border-b py-5"><CardTitle className="text-base">Schedule appointment</CardTitle><CardDescription>A scheduled visit is not counted as completed until arrival.</CardDescription></CardHeader><CardContent className="py-5"><VisitScheduler leads={options.leads} hosts={options.hosts} currentUserId={user.id} /></CardContent></Card>}
      </div>
    </div>
  );
}
