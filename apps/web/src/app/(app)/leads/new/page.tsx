import { ContactRound } from "lucide-react";
import { CaptureForm } from "@/components/capture-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createManualLead } from "@/lib/capture-actions";
import { can, requirePermission } from "@/lib/auth";
import { getLeadFormOptions } from "@/lib/form-options";

export const dynamic = "force-dynamic";

export default async function NewLeadPage() {
  const user = await requirePermission("leads:write");
  const options = await getLeadFormOptions(user.orgId);
  const canAssign = can(user, "leads:assign");
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Direct capture</p><h1 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight"><ContactRound className="size-6" />Add lead</h1><p className="mt-1 text-sm text-muted-foreground">Creates or matches the customer, records attribution and consent, then opens the opportunity.</p></div>
      <Card className="gap-0 py-0 shadow-sm"><CardHeader className="border-b py-5"><CardTitle className="text-base">Lead information</CardTitle></CardHeader><CardContent className="py-6"><CaptureForm mode="lead" projects={options.projects} agents={canAssign ? options.agents : []} orgId={user.orgId} currentUserId={user.id} canAssign={canAssign} action={createManualLead} /></CardContent></Card>
    </div>
  );
}
