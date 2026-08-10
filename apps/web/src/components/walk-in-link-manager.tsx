"use client";

import { useActionState, useState } from "react";
import { AlertCircle, CheckCircle2, Copy, Link2, Power, Trash2 } from "lucide-react";
import { createWalkInLink, deleteWalkInLink, setWalkInLinkActive, type WalkInLinkState } from "@/lib/walk-in-link-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  WALK_IN_LINK_EXTRA_FIELDS,
  WALK_IN_LINK_EXTRA_FIELD_LABELS,
  WALK_IN_LINK_TYPES,
  WALK_IN_LINK_TYPE_LABELS,
  walkInLinkPath,
} from "@/lib/walk-in-links";
import type { WalkInLinkRow } from "@/lib/walk-in-link-queries";
import { formatDateTime, formatNumber } from "@/lib/format";

const initialState: WalkInLinkState = { ok: false };

function FieldError({ state, name }: { state: WalkInLinkState; name: string }) {
  const message = state.fieldErrors?.[name]?.[0];
  return message ? <p className="mt-1 text-xs font-medium text-destructive">{message}</p> : null;
}

export function WalkInLinkManager({
  links,
  projects,
  agents,
}: {
  links: WalkInLinkRow[];
  projects: { id: string; name: string }[];
  agents: { id: string; name: string; role: string }[];
}) {
  const [state, formAction, pending] = useActionState(createWalkInLink, initialState);
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(slug: string) {
    const url = `${window.location.origin}${walkInLinkPath(slug)}`;
    try {
      await window.navigator.clipboard.writeText(url);
      setCopied(slug);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      window.prompt("Copy this link", url);
    }
  }

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-5 rounded-xl border bg-card p-5">
        <div>
          <h2 className="text-sm font-bold">New channel link</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            One link per channel. The passcode is shown to you now and stored hashed — write it
            down before you leave this page.
          </p>
        </div>

        {state.message && (
          <Alert variant={state.ok ? "default" : "destructive"}>
            {state.ok ? <CheckCircle2 /> : <AlertCircle />}
            <AlertTitle>{state.ok ? "Link created" : "Could not create the link"}</AlertTitle>
            <AlertDescription>
              {state.ok && state.createdSlug
                ? `Share ${walkInLinkPath(state.createdSlug)} with the channel. It appears in the list below.`
                : state.message}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="label">Channel name *</Label>
            <Input id="label" name="label" required placeholder="Windwave gate QR, Sai Realtors" />
            <FieldError state={state} name="label" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="linkType">Link type *</Label>
            <select id="linkType" name="linkType" required defaultValue="" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
              <option value="" disabled>Select a type…</option>
              {WALK_IN_LINK_TYPES.map((type) => (
                <option key={type} value={type}>{WALK_IN_LINK_TYPE_LABELS[type]}</option>
              ))}
            </select>
            <FieldError state={state} name="linkType" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contactName">Channel contact name</Label>
            <Input id="contactName" name="contactName" placeholder="Broker or team lead" />
            <p className="text-[11px] text-muted-foreground">Who owns this channel — not the visitor.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contactPhone">Channel contact phone</Label>
            <Input id="contactPhone" name="contactPhone" type="tel" placeholder="+91 98765 43210" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="passcode">Passcode *</Label>
            <Input id="passcode" name="passcode" required minLength={4} placeholder="At least 4 characters" />
            <FieldError state={state} name="passcode" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="expiresAt">Expires</Label>
            <Input id="expiresAt" name="expiresAt" type="date" />
            <FieldError state={state} name="expiresAt" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="projectId">Project</Label>
            <select id="projectId" name="projectId" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
              <option value="">Ask on the form</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ownerUserId">Route leads to</Label>
            <select id="ownerUserId" name="ownerUserId" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
              <option value="">Unassigned</option>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.role.replace(/_/g, " ")}</option>)}
            </select>
          </div>
        </div>

        <fieldset>
          <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Also ask the visitor for
          </legend>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Name and phone are always collected. Every extra question costs completions, so add
            only what this channel will actually act on.
          </p>
          <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
            {WALK_IN_LINK_EXTRA_FIELDS.map((field) => (
              <label key={field} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={`extra:${field}`} className="size-4 accent-primary" />
                {WALK_IN_LINK_EXTRA_FIELD_LABELS[field]}
              </label>
            ))}
          </div>
        </fieldset>

        <Button type="submit" disabled={pending}>
          <Link2 />
          {pending ? "Creating…" : "Create link"}
        </Button>
      </form>

      <div className="space-y-3">
        {links.length === 0 ? (
          <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            No channel links yet. The first one turns anonymous walk-ins into an attributable channel.
          </p>
        ) : (
          links.map((link) => {
            const expired = link.expiresAt ? new Date(link.expiresAt).getTime() < Date.now() : false;
            const live = link.isActive && !expired;
            return (
              <div key={link.id} className="rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{link.label}</p>
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium">
                        {WALK_IN_LINK_TYPE_LABELS[link.linkType]}
                      </span>
                      <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${live ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"}`}>
                        {expired ? "expired" : link.isActive ? "live" : "paused"}
                      </span>
                    </div>
                    <p className="tabular mt-1 truncate text-xs text-muted-foreground">
                      {walkInLinkPath(link.slug)}
                      {link.projectName ? ` · ${link.projectName}` : ""}
                      {link.ownerName ? ` · routes to ${link.ownerName}` : ""}
                    </p>
                    {link.contactName && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Contact: {link.contactName}{link.contactPhone ? ` · ${link.contactPhone}` : ""}
                      </p>
                    )}
                    <p className="tabular mt-2 text-xs text-muted-foreground">
                      {formatNumber(link.viewCount)} opens · {formatNumber(link.submissionCount)} check-ins
                      {link.lastSubmissionAt ? ` · last ${formatDateTime(link.lastSubmissionAt)}` : ""}
                      {link.expiresAt ? ` · expires ${formatDateTime(link.expiresAt)}` : ""}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => copy(link.slug)}>
                      <Copy />
                      {copied === link.slug ? "Copied" : "Copy link"}
                    </Button>
                    <form action={setWalkInLinkActive}>
                      <input type="hidden" name="linkId" value={link.id} />
                      <input type="hidden" name="isActive" value={link.isActive ? "false" : "true"} />
                      <Button type="submit" size="sm" variant="outline">
                        <Power />
                        {link.isActive ? "Pause" : "Resume"}
                      </Button>
                    </form>
                    {link.submissionCount === 0 && (
                      <form
                        action={deleteWalkInLink}
                        onSubmit={(event) => {
                          if (!window.confirm(`Delete the link "${link.label}"?`)) event.preventDefault();
                        }}
                      >
                        <input type="hidden" name="linkId" value={link.id} />
                        <Button type="submit" size="sm" variant="ghost" className="text-destructive">
                          <Trash2 />
                          Delete
                        </Button>
                      </form>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
