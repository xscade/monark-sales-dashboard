import { WifiOff } from "lucide-react";
import { randomUUID } from "node:crypto";
import { CaptureForm } from "@/components/capture-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createFreshWalkIn } from "@/lib/capture-actions";
import { can, requirePermission } from "@/lib/auth";
import { getLeadFormOptions } from "@/lib/form-options";

export const dynamic = "force-dynamic";

/**
 * The one capture surface.
 *
 * "Add lead" and "New walk-in" used to be separate pages asking the same
 * questions, which meant the same buyer could exist twice with different
 * amounts of detail depending on which button somebody happened to press.
 */
export default async function NewWalkInPage() {
  const user = await requirePermission("visits:write");
  const options = await getLeadFormOptions(user.orgId);
  const canAssign = can(user, "leads:assign");
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Reception desk</p><h2 className="mt-1 text-2xl font-bold tracking-tight">New walk-in</h2><p className="mt-1 text-sm text-muted-foreground">Capture the customer, the opportunity and — when they are here — the arrival, in one transaction.</p></div><span className="inline-flex items-center gap-1.5 self-start rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground"><WifiOff className="size-3.5" />Offline queue is ready</span></div>
      <Card className="gap-0 py-0 shadow-sm"><CardHeader className="border-b py-5"><CardTitle className="text-base">Visitor information</CardTitle></CardHeader><CardContent className="py-6"><CaptureForm projects={options.projects} agents={canAssign ? options.agents : []} orgId={user.orgId} currentUserId={user.id} canAssign={canAssign} visitId={randomUUID()} siteVisitId={randomUUID()} action={createFreshWalkIn} /></CardContent></Card>
    </div>
  );
}
