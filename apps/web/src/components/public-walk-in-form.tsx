"use client";

import { useActionState } from "react";
import { AlertCircle, CheckCircle2, KeyRound } from "lucide-react";
import { submitPublicWalkIn, type PublicWalkInState } from "@/lib/walk-in-link-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { WALK_IN_LINK_VISIT_TYPE, type WalkInLinkType } from "@/lib/walk-in-links";

const initialState: PublicWalkInState = { ok: false };

function FieldError({ state, name }: { state: PublicWalkInState; name: string }) {
  const message = state.fieldErrors?.[name]?.[0];
  return message ? <p className="mt-1 text-xs font-medium text-destructive">{message}</p> : null;
}

export function PublicWalkInForm({
  slug,
  linkType,
  extraFields,
  projectName,
}: {
  slug: string;
  linkType: WalkInLinkType;
  extraFields: string[];
  projectName: string | null;
}) {
  const [state, formAction, pending] = useActionState(submitPublicWalkIn, initialState);
  const has = (field: string) => extraFields.includes(field);

  if (state.ok) {
    return (
      <Alert>
        <CheckCircle2 />
        <AlertTitle>You are checked in</AlertTitle>
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="slug" value={slug} />

      {state.message && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="passcode" className="flex items-center gap-1.5">
          <KeyRound className="size-3.5" />
          Passcode
        </Label>
        <Input id="passcode" name="passcode" required autoComplete="off" placeholder="Ask the team for today's code" />
        <FieldError state={state} name="passcode" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="name">Your name *</Label>
          <Input id="name" name="name" required autoComplete="name" />
          <FieldError state={state} name="name" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone number *</Label>
          <Input id="phone" name="phone" type="tel" inputMode="tel" required autoComplete="tel" placeholder="+91 98765 43210" />
          <FieldError state={state} name="phone" />
        </div>
        {has("email") && (
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" />
            <FieldError state={state} name="email" />
          </div>
        )}
        {has("city") && (
          <div className="space-y-1.5">
            <Label htmlFor="city">City</Label>
            <Input id="city" name="city" autoComplete="address-level2" />
          </div>
        )}
        {has("preferredLanguage") && (
          <div className="space-y-1.5">
            <Label htmlFor="preferredLanguage">Preferred language</Label>
            <Input id="preferredLanguage" name="preferredLanguage" placeholder="English, Telugu…" />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="visitType">Where are you today?</Label>
          <select
            id="visitType"
            name="visitType"
            defaultValue={WALK_IN_LINK_VISIT_TYPE[linkType]}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="corporate_office">Corporate office</option>
            <option value="project_site">Project site{projectName ? ` · ${projectName}` : ""}</option>
            <option value="experience_centre">Experience centre</option>
          </select>
        </div>

        {has("configurations") && (
          <div className="space-y-1.5">
            <Label htmlFor="configurations">Configurations you are looking at</Label>
            <Input id="configurations" name="configurations" placeholder="3 BHK, 4 BHK" />
          </div>
        )}
        {has("accompanying") && (
          <div className="space-y-1.5">
            <Label htmlFor="accompanyingCount">People with you</Label>
            <Input id="accompanyingCount" name="accompanyingCount" type="number" min={0} max={20} defaultValue={0} />
          </div>
        )}
        {has("intent") && (
          <div className="space-y-1.5">
            <Label htmlFor="intentRating">How close are you to deciding?</Label>
            <select id="intentRating" name="intentRating" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
              <option value="">Prefer not to say</option>
              <option value="5">Ready to book</option>
              <option value="4">Shortlisting</option>
              <option value="3">Comparing options</option>
              <option value="2">Early research</option>
              <option value="1">Just looking</option>
            </select>
          </div>
        )}
        {has("notes") && (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="notes">Anything else we should know</Label>
            <Textarea id="notes" name="notes" rows={3} />
          </div>
        )}
      </div>

      <label className="flex items-start gap-2 rounded-xl border bg-muted/35 p-4 text-sm">
        <input type="checkbox" name="consent" className="mt-0.5 size-4 accent-primary" />
        <span>I agree to be contacted about this enquiry and to my details being used for advertising measurement.</span>
      </label>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Check in"}
      </Button>
    </form>
  );
}
