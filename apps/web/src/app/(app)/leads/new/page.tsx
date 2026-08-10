import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The separate "add lead" form is gone; capture is unified on the walk-in form,
 * which collects everything this one did plus the arrival.
 *
 * The route survives as a redirect rather than a 404 because it is bookmarked,
 * linked from older emails, and muscle memory. Lead ingestion from websites and
 * ad platforms is unaffected — that runs through the public `/v1` API, which
 * never touched this page.
 */
export default async function NewLeadPage() {
  redirect("/walk-ins/new");
}
