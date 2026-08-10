import Link from "next/link";
import { CONVERSION_EVENTS } from "@monark/core";
import { Card, EmptyState, SubmitButton } from "@/components/ui";
import {
  createDestination,
  deleteEventMapping,
  replaceDestinationCredentials,
  saveDestination,
  upsertEventMapping,
  validateDestinationConnection,
} from "@/lib/integration-actions";
import { getIntegrationSettings } from "@/lib/integration-queries";
import { SettingsFlash } from "../settings-flash";

export const dynamic = "force-dynamic";
const field = "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950";

export default async function IntegrationsPage({ searchParams }: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const [messages, data] = await Promise.all([searchParams, getIntegrationSettings()]);
  return <div className="space-y-5">
    <div>
      <Link href="/settings" className="text-xs text-zinc-500">← Settings</Link>
      <h1 className="mt-2 text-xl font-semibold">Meta & Google integrations</h1>
      <p className="mt-0.5 text-sm text-zinc-500">Replace-only credentials, destination config and event routing</p>
    </div>
    <SettingsFlash notice={messages.notice} error={messages.error} />
    <Card
      title="Add a destination"
      subtitle="New destinations start disabled and in dry-run mode. Add credentials and mappings before enabling delivery."
    >
      <form action={createDestination} className="grid gap-3 p-5 md:grid-cols-[1fr_1fr_1fr_auto]">
        <label className="text-xs">Name<input required name="name" placeholder="Meta — Monark" className={field} /></label>
        <label className="text-xs">Platform<select name="platform" className={field}><option value="meta_capi">Meta CAPI</option><option value="google_data_manager">Google Data Manager</option></select></label>
        <label className="text-xs">Project scope<select name="projectId" className={field}><option value="">All projects</option>{data.activeProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <div className="self-end"><SubmitButton>Create destination</SubmitButton></div>
      </form>
    </Card>
    {data.destinations.length === 0 ? <Card><EmptyState title="No conversion destinations yet" hint="Create one above, then add its platform config, encrypted credentials and event mappings." /></Card> : data.destinations.map((d) => {
      const config = d.config as Record<string, unknown>;
      const mappings = data.mappings.filter((m) => m.destinationId === d.id);
      return <Card
        key={d.id}
        title={d.name}
        subtitle={`${d.platform.replace(/_/g, " ")} · ${d.isEnabled ? "enabled" : "disabled"} · ${d.dryRun ? "dry run" : "live"} · ${d.hasCredentials ? "credentials stored" : "credentials missing"}`}
      >
        <div className="space-y-6 p-5">
          <form action={saveDestination} className="space-y-3">
            <input type="hidden" name="id" value={d.id} /><input type="hidden" name="platform" value={d.platform} />
            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-xs">Name<input name="name" defaultValue={d.name} className={field} /></label>
              <label className="text-xs">Project scope<select name="projectId" defaultValue={d.projectId ?? ""} className={field}><option value="">All projects</option>{data.activeProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              {d.platform === "meta_capi" ? <>
                <label className="text-xs">Dataset ID<input name="datasetId" defaultValue={String(config.datasetId ?? "")} className={field} /></label>
                <label className="text-xs">API version<input name="apiVersion" defaultValue={String(config.apiVersion ?? "v21.0")} className={field} /></label>
                <label className="text-xs">Test event code<input name="testEventCode" defaultValue={String(config.testEventCode ?? "")} className={field} /></label>
              </> : <>
                <label className="text-xs">Operating account ID<input name="operatingAccountId" defaultValue={String(config.operatingAccountId ?? "")} className={field} /></label>
                <label className="text-xs">Login account ID<input name="loginAccountId" defaultValue={String(config.loginAccountId ?? "")} className={field} /></label>
                <label className="text-xs">Product destination ID<input name="productDestinationId" defaultValue={String(config.productDestinationId ?? "")} className={field} /></label>
                <label className="text-xs">Account type<select name="accountType" defaultValue={String(config.accountType ?? "GOOGLE_ADS")} className={field}><option>GOOGLE_ADS</option><option>GOOGLE_ANALYTICS_PROPERTY</option><option>FLOODLIGHT_CONFIG</option></select></label>
              </>}
            </div><SubmitButton>Save configuration</SubmitButton>
          </form>
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <form action={replaceDestinationCredentials} className="space-y-2">
              <input type="hidden" name="id" value={d.id} /><input type="hidden" name="platform" value={d.platform} />
              {d.platform === "meta_capi"
                ? <label className="text-xs">Replace access token<input type="password" name="accessToken" autoComplete="new-password" className={field} /></label>
                : <label className="text-xs">Replace service-account JSON<textarea name="serviceAccountJson" rows={4} className={field} /></label>}
              <SubmitButton variant="secondary">Replace credentials</SubmitButton>
            </form>
            <form action={validateDestinationConnection} className="self-end"><input type="hidden" name="id" value={d.id} /><SubmitButton variant="secondary">Validate locally</SubmitButton></form>
          </div>
          <div className="space-y-3 border-t border-zinc-200 pt-5 dark:border-zinc-800">
            <h3 className="text-sm font-semibold">Event mappings</h3>
            {mappings.map(m => <div key={m.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <form action={upsertEventMapping} className="grid gap-2 md:grid-cols-6">
                <input type="hidden" name="destinationId" value={d.id} />
                <label className="text-xs">Event<select name="eventType" defaultValue={m.eventType} className={field}>{CONVERSION_EVENTS.map(e => <option key={e}>{e}</option>)}</select></label>
                <label className="text-xs">Platform name<input name="platformEventName" defaultValue={m.platformEventName} className={field} /></label>
                <label className="text-xs">Destination/action ID<input name="platformDestinationId" defaultValue={m.platformDestinationId ?? ""} className={field} /></label>
                <label className="text-xs">Value strategy<select name="valueStrategy" defaultValue={m.valueStrategy} className={field}><option>none</option><option>fixed</option><option>modelled</option><option>actual</option></select></label>
                <label className="text-xs">Fixed value<input name="fixedValue" defaultValue={m.fixedValue ?? ""} className={field} /></label>
                <label className="text-xs">State<select name="isEnabled" defaultValue={String(m.isEnabled)} className={field}><option value="true">Enabled</option><option value="false">Disabled</option></select></label>
                <SubmitButton>Save mapping</SubmitButton>
              </form>
              <form action={deleteEventMapping} className="mt-2"><input type="hidden" name="id" value={m.id} /><input type="hidden" name="destinationId" value={d.id} /><SubmitButton variant="danger">Delete mapping</SubmitButton></form>
            </div>)}
            <form action={upsertEventMapping} className="grid gap-2 rounded-lg bg-zinc-50 p-3 md:grid-cols-6 dark:bg-zinc-950">
              <input type="hidden" name="destinationId" value={d.id} />
              <label className="text-xs">New event<select name="eventType" className={field}>{CONVERSION_EVENTS.map(e => <option key={e}>{e}</option>)}</select></label>
              <label className="text-xs">Platform name<input name="platformEventName" className={field} /></label>
              <label className="text-xs">Destination/action ID<input name="platformDestinationId" className={field} /></label>
              <label className="text-xs">Value strategy<select name="valueStrategy" defaultValue="modelled" className={field}><option>none</option><option>fixed</option><option>modelled</option><option>actual</option></select></label>
              <label className="text-xs">Fixed value<input name="fixedValue" className={field} /></label>
              <input type="hidden" name="isEnabled" value="true" /><div className="self-end"><SubmitButton>Add mapping</SubmitButton></div>
            </form>
          </div>
        </div>
      </Card>;
    })}
    <p className="text-xs text-zinc-500">“Validate locally” checks schema and encrypted credential presence only; it never contacts Meta or Google.</p>
  </div>;
}
