import Link from "next/link";
import { ArrowLeft, Braces, CheckCircle2, Code2, ExternalLink, KeyRound, RadioTower } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { getSourceHealth } from "@/lib/source-queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

const sourceCodes = [
  "website_form", "landing_page", "meta_lead_ad", "google_lead_form", "whatsapp",
  "phone_call", "walk_in", "referral", "influencer", "broker", "csv_import",
  "manual_entry", "portal", "other",
];

export default async function SourcesSettingsPage() {
  const user = await requirePermission("settings:write");
  const health = await getSourceHealth(user.orgId);
  const baseUrl = (process.env.APP_URL ?? "https://monark-sales-dashboard-api.vercel.app").replace(/\/$/, "");
  const endpoint = `${baseUrl}/v1/leads`;

  return (
    <div className="space-y-6">
      <div><Button asChild variant="ghost" size="sm" className="-ml-3 mb-2"><Link href="/settings"><ArrowLeft />Settings</Link></Button><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Lead capture</p><h2 className="mt-1 text-2xl font-bold tracking-tight">Sources & website API</h2><p className="mt-1 text-sm text-muted-foreground">One ingestion contract for website forms, agencies, portals, webhooks and manual capture.</p></div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,.75fr)]">
        <Card className="gap-0 py-0 shadow-sm">
          <CardHeader className="border-b py-5"><CardTitle className="flex items-center gap-2 text-base"><Code2 className="size-4 text-primary" />Website form endpoint</CardTitle><CardDescription>Use a project-scoped browser key. Never put a service-role key or integration credential in a website.</CardDescription></CardHeader>
          <CardContent className="space-y-5 py-5">
            <div><p className="mb-1.5 text-xs font-semibold text-muted-foreground">POST endpoint</p><code className="block overflow-x-auto rounded-lg border bg-muted/45 px-3 py-2.5 text-xs font-semibold text-foreground">{endpoint}</code></div>
            <div className="rounded-xl border bg-[#172722] p-4 text-xs text-emerald-50 shadow-inner"><pre className="overflow-x-auto leading-6"><code>{`fetch("${endpoint}", {
  method: "POST",
  headers: {
    "Authorization": "Bearer <website-api-key>",
    "Content-Type": "application/json",
    "Idempotency-Key": crypto.randomUUID()
  },
  body: JSON.stringify({
    name: "Customer name",
    phone: "+919876543210",
    source: "website_form",
    consent: { marketing: true, ad_user_data: true }
  })
})`}</code></pre></div>
            <div className="flex flex-wrap gap-2"><Button asChild><Link href="/settings/api"><KeyRound />Create project key</Link></Button><Button asChild variant="outline"><a href="/monark.js" target="_blank"><Braces />View hosted snippet<ExternalLink /></a></Button></div>
          </CardContent>
        </Card>

        <Card className="gap-0 py-0 shadow-sm">
          <CardHeader className="border-b py-5"><CardTitle className="text-base">Hosted form helper</CardTitle><CardDescription>Captures UTMs, click IDs, page context and a stable browser event id.</CardDescription></CardHeader>
          <CardContent className="space-y-4 py-5">
            <code className="block overflow-x-auto rounded-lg border bg-muted/45 p-3 text-[11px] leading-5">{`<script src="${baseUrl}/monark.js"
  data-endpoint="${endpoint}"
  data-key="<website-api-key>"
  defer></script>`}</code>
            <ul className="space-y-2 text-xs text-muted-foreground"><li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-primary" />Optional fields are omitted, not sent as null.</li><li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-primary" />Consent defaults to denied until the customer opts in.</li><li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-primary" />Submission retries reuse the same idempotency identity.</li></ul>
          </CardContent>
        </Card>
      </div>

      <Card className="gap-0 py-0 shadow-sm">
        <CardHeader className="border-b py-5"><CardTitle className="flex items-center gap-2 text-base"><RadioTower className="size-4 text-primary" />Source health</CardTitle><CardDescription>Ground-truth outcomes by the touchpoint source received by the CRM.</CardDescription></CardHeader>
        <CardContent className="px-0">
          {health.length === 0 ? <div className="p-10 text-center text-sm text-muted-foreground">No inbound touchpoints yet.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead className="border-b bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-5 py-3">Source</th><th className="px-4 py-3 text-right">Touchpoints</th><th className="px-4 py-3 text-right">Leads</th><th className="px-4 py-3 text-right">Visits</th><th className="px-4 py-3 text-right">Bookings</th><th className="px-5 py-3 text-right">Last received</th></tr></thead><tbody className="divide-y">{health.map((row) => <tr key={row.source}><td className="px-5 py-3"><Badge variant="secondary" className="capitalize">{row.source.replace(/_/g, " ")}</Badge></td><td className="tabular px-4 py-3 text-right">{formatNumber(row.touchpoints)}</td><td className="tabular px-4 py-3 text-right">{formatNumber(row.leads)}</td><td className="tabular px-4 py-3 text-right">{formatNumber(row.visits)}</td><td className="tabular px-4 py-3 text-right font-semibold">{formatNumber(row.bookings)}</td><td className="px-5 py-3 text-right text-xs text-muted-foreground">{row.lastReceivedAt ? formatDateTime(row.lastReceivedAt) : "Never"}</td></tr>)}</tbody></table></div>}
        </CardContent>
      </Card>

      <div><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Accepted source codes</p><div className="flex flex-wrap gap-2">{sourceCodes.map((source) => <code key={source} className="rounded-md border bg-card px-2 py-1 text-[11px]">{source}</code>)}</div></div>
    </div>
  );
}
