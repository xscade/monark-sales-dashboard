"use client";

import { startTransition, useActionState, useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, CloudOff, CloudUpload, ShieldCheck, UserPlus } from "lucide-react";
import Link from "next/link";
import type { CaptureState } from "@/lib/capture-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Option {
  id: string;
  name: string;
}

interface CaptureFormProps {
  projects: (Option & { city?: string | null })[];
  agents: (Option & { role: string })[];
  orgId: string;
  currentUserId: string;
  canAssign?: boolean;
  visitId: string;
  siteVisitId: string;
  action: (state: CaptureState, formData: FormData) => Promise<CaptureState>;
}

const initialState: CaptureState = { ok: false };

function FieldError({ state, name }: { state: CaptureState; name: string }) {
  const message = state.fieldErrors?.[name]?.[0];
  return message ? <p className="mt-1 text-xs font-medium text-destructive">{message}</p> : null;
}

type OfflineItem = { id: string; createdAt: number; values: Record<string, string> };
const OFFLINE_QUEUE_PREFIX = "monark:offline-walk-ins:v2";
const OFFLINE_MAX_AGE = 72 * 60 * 60 * 1000;
const OFFLINE_QUEUE_LIMIT = 20;

type QueueResult =
  | { ok: true; items: OfflineItem[] }
  | { ok: false; message: string };

type StorageResult =
  | { ok: true }
  | { ok: false; message: string };

function storageFailureMessage(error: unknown) {
  const quotaExceeded =
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");
  return quotaExceeded
    ? "This device's offline storage is full. The form has not been cleared; reconnect and sync queued walk-ins before trying again."
    : "Offline storage is unavailable on this device. The form has not been cleared; reconnect before submitting.";
}

function isOfflineItem(value: unknown): value is OfflineItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<OfflineItem>;
  if (
    typeof item.id !== "string" ||
    !item.id ||
    typeof item.createdAt !== "number" ||
    !Number.isFinite(item.createdAt)
  ) return false;
  if (!item.values || typeof item.values !== "object" || Array.isArray(item.values)) return false;
  return Object.values(item.values).every((entry) => typeof entry === "string");
}

function parseOfflineQueue(raw: string | null): OfflineItem[] | null {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) && value.every(isOfflineItem) ? value : null;
  } catch {
    return null;
  }
}

function writeOfflineQueue(key: string, items: OfflineItem[]): StorageResult {
  try {
    if (items.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(items));
    return { ok: true };
  } catch (error) {
    return { ok: false, message: storageFailureMessage(error) };
  }
}

function readOfflineQueue(key: string): QueueResult {
  try {
    const value = parseOfflineQueue(window.localStorage.getItem(key));
    if (!value) {
      return {
        ok: false,
        message: "The existing offline queue could not be read and was left untouched. Reconnect and contact support before capturing another visitor.",
      };
    }
    const cutoff = Date.now() - OFFLINE_MAX_AGE;
    const active = value.filter((item) => item.createdAt >= cutoff);
    // Purge expired customer details from the device instead of only hiding
    // them in memory. The queue is deliberately scoped per organisation and
    // user so a later login cannot submit the record into another tenant.
    if (active.length !== value.length) {
      const cleanup = writeOfflineQueue(key, active);
      if (!cleanup.ok) return cleanup;
    }
    return { ok: true, items: active };
  } catch (error) {
    return { ok: false, message: storageFailureMessage(error) };
  }
}

function sweepExpiredOfflineQueues(): string | null {
  let keys: string[];
  try {
    const storage = window.localStorage;
    keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key): key is string => Boolean(key?.startsWith(`${OFFLINE_QUEUE_PREFIX}:`)));
  } catch (error) {
    return storageFailureMessage(error);
  }

  const cutoff = Date.now() - OFFLINE_MAX_AGE;
  for (const key of keys) {
    try {
      const queue = parseOfflineQueue(window.localStorage.getItem(key));
      // Unknown or malformed data is preserved rather than overwritten. Only
      // records with a valid timestamp can be safely classified as expired.
      if (!queue) continue;
      const active = queue.filter((item) => item.createdAt >= cutoff);
      if (active.length === queue.length && queue.length > 0) continue;
      const cleanup = writeOfflineQueue(key, active);
      if (!cleanup.ok) return cleanup.message;
    } catch (error) {
      return storageFailureMessage(error);
    }
  }
  return null;
}

export function CaptureForm({ projects, agents, orgId, currentUserId, canAssign = false, visitId, siteVisitId, action }: CaptureFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  // One capture surface. A separate "add lead" form asked the same questions
  // and produced a weaker record, so the arrival is now a property of this form
  // rather than a different page.
  const walkIn = true;
  const defaultOwner = agents.some((agent) => agent.id === currentUserId) ? currentUserId : "";
  const [currentVisitId, setCurrentVisitId] = useState(visitId);
  const [currentSiteVisitId, setCurrentSiteVisitId] = useState(siteVisitId);
  const [visitType, setVisitType] = useState("corporate_office");
  const [recordVisit, setRecordVisit] = useState(true);
  const [alsoSiteVisit, setAlsoSiteVisit] = useState(false);
  // A walk-in already standing at the project site IS the site visit; offering
  // to record a second one would double-count the strongest signal we have.
  const siteVisitRedundant = visitType === "project_site";
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);
  const [blockedItemId, setBlockedItemId] = useState<string | null>(null);
  const inFlight = useRef<string | null>(null);
  const offlineQueueKey = `${OFFLINE_QUEUE_PREFIX}:${orgId}:${currentUserId}`;

  const syncNext = useCallback(() => {
    if (
      !walkIn || typeof window === "undefined" || !window.navigator.onLine ||
      inFlight.current || blockedItemId
    ) return;
    const queue = readOfflineQueue(offlineQueueKey);
    if (!queue.ok) {
      setOfflineNotice(queue.message);
      return;
    }
    if (queue.items.length === 0) return;
    const item = queue.items[0]!;
    inFlight.current = item.id;
    setOfflineNotice(`Syncing ${queue.items.length} offline walk-in${queue.items.length === 1 ? "" : "s"}…`);
    const data = new FormData();
    for (const [key, value] of Object.entries(item.values)) data.set(key, value);
    data.set("offlineSync", "true");
    startTransition(() => formAction(data));
  }, [blockedItemId, formAction, offlineQueueKey, walkIn]);

  useEffect(() => {
    if (!walkIn) return;
    const sweepError = sweepExpiredOfflineQueues();
    if (sweepError) setOfflineNotice(sweepError);
    const onOnline = () => syncNext();
    window.addEventListener("online", onOnline);
    syncNext();
    return () => window.removeEventListener("online", onOnline);
  }, [syncNext, walkIn]);

  useEffect(() => {
    const itemId = inFlight.current;
    if (!itemId || pending || !state.message) return;
    if (state.ok) {
      const queue = readOfflineQueue(offlineQueueKey);
      if (!queue.ok) {
        inFlight.current = null;
        setBlockedItemId(itemId);
        setOfflineNotice(`Walk-in synced, but the device queue could not be updated. ${queue.message}`);
        return;
      }
      const remaining = queue.items.filter((item) => item.id !== itemId);
      const stored = writeOfflineQueue(offlineQueueKey, remaining);
      if (!stored.ok) {
        inFlight.current = null;
        setBlockedItemId(itemId);
        setOfflineNotice(`Walk-in synced, but the device queue could not be updated. ${stored.message}`);
        return;
      }
      inFlight.current = null;
      setBlockedItemId(null);
      setOfflineNotice(remaining.length ? `${remaining.length} walk-in${remaining.length === 1 ? "" : "s"} waiting to sync…` : "All offline walk-ins synced");
      const timer = window.setTimeout(syncNext, 150);
      return () => window.clearTimeout(timer);
    }
    inFlight.current = null;
    setBlockedItemId(itemId);
    setOfflineNotice(`Sync paused: ${state.message}`);
  }, [offlineQueueKey, pending, state.message, state.ok, syncNext]);

  function discardBlockedItem() {
    if (!blockedItemId) return;
    const queue = readOfflineQueue(offlineQueueKey);
    if (!queue.ok) {
      setOfflineNotice(queue.message);
      return;
    }
    const remaining = queue.items.filter((item) => item.id !== blockedItemId);
    const stored = writeOfflineQueue(offlineQueueKey, remaining);
    if (!stored.ok) {
      setOfflineNotice(stored.message);
      return;
    }
    setBlockedItemId(null);
    setOfflineNotice(
      remaining.length
        ? `Discarded the blocked record. ${remaining.length} walk-in${remaining.length === 1 ? "" : "s"} waiting to sync…`
        : "Discarded the blocked record. The offline queue is empty.",
    );
  }

  function captureOffline(event: React.FormEvent<HTMLFormElement>) {
    if (!walkIn || window.navigator.onLine) return;
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const phone = String(data.get("phone") ?? "").trim();
    const email = String(data.get("email") ?? "").trim();
    if (!phone && !email) {
      setOfflineNotice("Add a phone number or email before saving this walk-in offline.");
      return;
    }
    const values: Record<string, string> = {};
    for (const [key, value] of data.entries()) if (typeof value === "string") values[key] = value;
    const queue = readOfflineQueue(offlineQueueKey);
    if (!queue.ok) {
      setOfflineNotice(queue.message);
      return;
    }
    if (queue.items.length >= OFFLINE_QUEUE_LIMIT) {
      setOfflineNotice(
        `Offline queue is full (${OFFLINE_QUEUE_LIMIT} walk-ins). Reconnect and keep this page open to sync before capturing another visitor. The form has not been cleared.`,
      );
      return;
    }
    let id = values.visitId || currentVisitId || window.crypto.randomUUID();
    while (queue.items.some((item) => item.id === id)) id = window.crypto.randomUUID();
    values.visitId = id;
    values.siteVisitId = values.siteVisitId || window.crypto.randomUUID();
    const queued = [...queue.items, { id, createdAt: Date.now(), values }];
    const stored = writeOfflineQueue(offlineQueueKey, queued);
    if (!stored.ok) {
      setOfflineNotice(stored.message);
      return;
    }
    form.reset();
    setCurrentVisitId(window.crypto.randomUUID());
    setCurrentSiteVisitId(window.crypto.randomUUID());
    setRecordVisit(true);
    setAlsoSiteVisit(false);
    setVisitType("corporate_office");
    setOfflineNotice(`Saved on this device. ${queued.length} walk-in${queued.length === 1 ? "" : "s"} will sync when online.`);
  }

  return (
    <form action={formAction} onSubmit={captureOffline} className="space-y-7">
      {currentVisitId && <input type="hidden" name="visitId" value={currentVisitId} />}
      {currentSiteVisitId && <input type="hidden" name="siteVisitId" value={currentSiteVisitId} />}
      {walkIn && offlineNotice && (
        <Alert>
          {offlineNotice.includes("synced") || offlineNotice.includes("Syncing") ? <CloudUpload /> : <CloudOff />}
          <AlertTitle>Offline capture</AlertTitle>
          <AlertDescription>
            {offlineNotice}
            {blockedItemId && (
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={discardBlockedItem}>
                Discard blocked record and continue
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      {state.message && (
        <Alert variant={state.ok ? "default" : "destructive"}>
          {state.ok ? <CheckCircle2 /> : <AlertCircle />}
          <AlertTitle>{state.ok ? "Saved" : "Could not save"}</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <section>
        <div className="mb-4 flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><UserPlus className="size-4" /></span>
          <div><h2 className="text-sm font-bold">Customer details</h2><p className="text-xs text-muted-foreground">Phone or email is required for safe deduplication.</p></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="name">Full name</Label><Input id="name" name="name" placeholder="Customer name" autoComplete="name" /><FieldError state={state} name="name" /></div>
          <div className="space-y-1.5"><Label htmlFor="phone">Phone number</Label><Input id="phone" name="phone" type="tel" inputMode="tel" placeholder="+91 98765 43210" autoComplete="tel" /><FieldError state={state} name="phone" /></div>
          <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" placeholder="buyer@example.com" autoComplete="email" /><FieldError state={state} name="email" /></div>
          <div className="space-y-1.5"><Label htmlFor="city">City</Label><Input id="city" name="city" placeholder="Hyderabad" autoComplete="address-level2" /></div>
          <div className="space-y-1.5"><Label htmlFor="preferredLanguage">Preferred language</Label><Input id="preferredLanguage" name="preferredLanguage" placeholder="English, Telugu…" /></div>
        </div>
      </section>

      <section className="border-t pt-6">
        <h2 className="text-sm font-bold">Opportunity</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Assign the enquiry and preserve how it reached the team.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="projectId">Project{recordVisit ? " *" : ""}</Label>
            {/* A recorded arrival must name a project — the visit conversion is
                worthless to the ad platforms without one. An enquiry can wait. */}
            <select id="projectId" name="projectId" required={recordVisit} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="">{recordVisit ? "Select the project visited…" : "No project selected"}</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}{project.city ? ` · ${project.city}` : ""}</option>)}
            </select>
            <FieldError state={state} name="projectId" />
          </div>
          {canAssign ? <div className="space-y-1.5">
            <Label htmlFor="ownerUserId">Owner</Label>
            <select id="ownerUserId" name="ownerUserId" defaultValue={defaultOwner} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="">Unassigned</option>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.role.replace(/_/g, " ")}</option>)}
            </select>
          </div> : <input type="hidden" name="ownerUserId" value={currentUserId} />}

          {/* Kept from the old lead form. A visitor sent by a broker is a
              walk-in AND a broker enquiry; collapsing the two lost the channel. */}
          <div className="space-y-1.5"><Label htmlFor="source">Source</Label><select id="source" name="source" defaultValue="walk_in" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"><option value="walk_in">Walk-in</option><option value="manual_entry">Manual entry</option><option value="phone_call">Phone call</option><option value="whatsapp">WhatsApp</option><option value="referral">Referral</option><option value="broker">Broker</option><option value="portal">Property portal</option><option value="other">Other</option></select></div>
          <div className="space-y-1.5"><Label htmlFor="sourceDetail">Source detail</Label><Input id="sourceDetail" name="sourceDetail" placeholder="Referrer, portal, campaign…" /></div>

          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="notes">Notes</Label><Textarea id="notes" name="notes" rows={4} placeholder="Budget, configuration, context, and the promised next step…" /></div>
        </div>
      </section>

      <section className="border-t pt-6">
        <label className="flex items-start gap-2.5">
          {/* Collapsing this section must also clear the site-visit block: its
              date field is `required`, and a required control inside a hidden
              container blocks submission with an error nobody can see. */}
          <input type="checkbox" name="recordVisit" checked={recordVisit} onChange={(event) => { setRecordVisit(event.target.checked); if (!event.target.checked) setAlsoSiteVisit(false); }} className="mt-0.5 size-4 accent-primary" />
          <span><span className="block text-sm font-bold">The visitor is here now</span><span className="block text-xs text-muted-foreground">Records the arrival and fires the offline conversion. Untick for a phone or online enquiry — the opportunity is still created.</span></span>
        </label>

        <div className={recordVisit ? "mt-4 grid gap-4 sm:grid-cols-2" : "hidden"}>
          <div className="space-y-1.5"><Label htmlFor="visitType">Location</Label><select id="visitType" name="visitType" value={visitType} onChange={(event) => setVisitType(event.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"><option value="corporate_office">Corporate office</option><option value="project_site">Project site</option><option value="experience_centre">Experience centre</option></select></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="accompanyingCount">With visitor</Label><Input id="accompanyingCount" name="accompanyingCount" type="number" min={0} max={20} defaultValue={0} /></div>
            <div className="space-y-1.5"><Label htmlFor="intentRating">Intent</Label><select id="intentRating" name="intentRating" className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"><option value="">Unrated</option><option value="5">Very high</option><option value="4">High</option><option value="3">Medium</option><option value="2">Low</option><option value="1">Exploring</option></select></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="accompanyingRelations">Who came with them</Label><Input id="accompanyingRelations" name="accompanyingRelations" placeholder="Spouse, parents" /></div>
          <div className="space-y-1.5"><Label htmlFor="configurationsViewed">Configurations viewed</Label><Input id="configurationsViewed" name="configurationsViewed" placeholder="3 BHK, 4 BHK" /></div>
          <div className="space-y-1.5"><Label htmlFor="unitsViewed">Plans or units shown</Label><Input id="unitsViewed" name="unitsViewed" placeholder="Type 1, A-804" /></div>
          <div className="space-y-1.5"><Label htmlFor="nextAction">Next action</Label><Input id="nextAction" name="nextAction" placeholder="Site visit, family call, proposal" /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="objections">Objections</Label><Input id="objections" name="objections" placeholder="Price, floor, possession timeline" /></div>

          <div className="sm:col-span-2 rounded-xl border bg-muted/35 p-4">
            <label className="flex items-start gap-2.5">
              <input type="checkbox" name="alsoSiteVisit" checked={alsoSiteVisit && !siteVisitRedundant} disabled={siteVisitRedundant} onChange={(event) => setAlsoSiteVisit(event.target.checked)} className="mt-0.5 size-4 accent-primary disabled:opacity-40" />
              <span><span className="block text-sm font-bold">They also visited the project site</span><span className="block text-xs text-muted-foreground">{siteVisitRedundant ? "Already recorded — this visit is at the project site." : "Records a second, separate site visit. Standing on the plot is a stronger signal than sitting in the office, and the two are reported to Meta and Google as different events."}</span></span>
            </label>

            {alsoSiteVisit && !siteVisitRedundant && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5"><Label htmlFor="siteVisitAt">When they were on site *</Label><Input id="siteVisitAt" name="siteVisitAt" type="datetime-local" required /><FieldError state={state} name="siteVisitAt" /></div>
                <div className="space-y-1.5">
                  <Label htmlFor="siteVisitHostUserId">Site host</Label>
                  <select id="siteVisitHostUserId" name="siteVisitHostUserId" defaultValue={defaultOwner} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                    <option value="">Same as owner</option>
                    {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.role.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5"><Label htmlFor="siteVisitUnitsViewed">Units seen on site</Label><Input id="siteVisitUnitsViewed" name="siteVisitUnitsViewed" placeholder="A-804, sample flat" /></div>
                <div className="space-y-1.5"><Label htmlFor="siteVisitIntentRating">Intent after the site visit</Label><select id="siteVisitIntentRating" name="siteVisitIntentRating" className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"><option value="">Unrated</option><option value="5">Very high</option><option value="4">High</option><option value="3">Medium</option><option value="2">Low</option><option value="1">Exploring</option></select></div>
                <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="siteVisitNotes">Site visit notes</Label><Input id="siteVisitNotes" name="siteVisitNotes" placeholder="Which tower, what they reacted to, who accompanied them" /></div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border bg-muted/35 p-4">
        <div className="flex gap-3"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" /><div><h2 className="text-sm font-bold">Consent captured with this record</h2><p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">Only tick permissions the customer actually granted. Unticked consent blocks ad-data forwarding.</p></div></div>
        <div className="mt-3 space-y-2 pl-7 text-sm">
          <label className="flex items-start gap-2"><input type="checkbox" name="marketingConsent" className="mt-0.5 size-4 accent-primary" /><span>Customer agrees to sales and marketing contact.</span></label>
          <label className="flex items-start gap-2"><input type="checkbox" name="adConsent" className="mt-0.5 size-4 accent-primary" /><span>Customer permits hashed data for advertising measurement.</span></label>
        </div>
      </section>

      <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-between">
        <Button type="button" variant="ghost" asChild><Link href="/walk-ins"><ArrowLeft />Cancel</Link></Button>
        <Button type="submit" size="lg" disabled={pending}>{pending ? "Saving…" : recordVisit ? "Save & check in" : "Save enquiry"}</Button>
      </div>
    </form>
  );
}
