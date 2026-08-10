import { notFound } from "next/navigation";
import { Building2 } from "lucide-react";
import { PublicWalkInForm } from "@/components/public-walk-in-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPublicWalkInLink, recordWalkInLinkView } from "@/lib/walk-in-link-queries";
import { WALK_IN_LINK_TYPE_LABELS } from "@/lib/walk-in-links";

export const dynamic = "force-dynamic";

/**
 * The public walk-in form.
 *
 * Unauthenticated by design — it is a QR code on a gate and a link in a
 * broker's WhatsApp. The passcode on the form is the only gate, and the link
 * row supplies the organisation, project and owner so nothing that arrives in
 * the request body can redirect a lead somewhere it does not belong.
 */
export const metadata = { robots: { index: false, follow: false } };

export default async function PublicWalkInPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const link = await getPublicWalkInLink(slug);
  if (!link) notFound();

  const expired = link.expiresAt ? new Date(link.expiresAt).getTime() < Date.now() : false;
  const open = link.isActive && !expired;
  if (open) await recordWalkInLinkView(link.id);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-sm font-black text-primary-foreground">
          {link.orgName.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <p className="text-sm font-bold">{link.orgName}</p>
          <p className="text-xs text-muted-foreground">
            {WALK_IN_LINK_TYPE_LABELS[link.linkType]}
            {link.projectName ? ` · ${link.projectName}` : ""}
          </p>
        </div>
      </div>

      <Card className="gap-0 py-0 shadow-sm">
        <CardHeader className="border-b py-5">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="size-4" />
            {open ? "Visitor check-in" : "Check-in closed"}
          </CardTitle>
        </CardHeader>
        <CardContent className="py-6">
          {open ? (
            <PublicWalkInForm
              slug={link.slug}
              linkType={link.linkType}
              extraFields={link.extraFields ?? []}
              projectName={link.projectName}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              This check-in link is no longer active. Please ask the team for a current link.
            </p>
          )}
        </CardContent>
      </Card>

      <p className="mt-5 text-center text-xs text-muted-foreground">
        Your details go to the {link.orgName} sales team only.
      </p>
    </main>
  );
}
