import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { getLeadFormOptions } from "@/lib/form-options";
import { listWalkInLinks } from "@/lib/walk-in-link-queries";
import { WalkInLinkManager } from "@/components/walk-in-link-manager";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/**
 * Channel links.
 *
 * Restricted to `settings:write` rather than `visits:write`: a link is a
 * standing, publicly reachable door into lead capture, which is an
 * administrative decision, not a reception-desk one.
 */
export default async function WalkInLinksPage() {
  const user = await requirePermission("settings:write");
  const [links, options] = await Promise.all([
    listWalkInLinks(user.orgId),
    getLeadFormOptions(user.orgId),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Field operations</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Walk-in links</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Passcode-gated forms a visitor can fill in themselves. Every check-in keeps the channel
            it came from, so brokers and site QRs stop being indistinguishable from each other.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/walk-ins"><ArrowLeft />Walk-in desk</Link>
        </Button>
      </div>

      <WalkInLinkManager links={links} projects={options.projects} agents={options.agents} />
    </div>
  );
}
