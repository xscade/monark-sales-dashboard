"use client";

import { useActionState, useEffect, useState } from "react";
import { AlertCircle, KeyRound, Lock, UserPlus } from "lucide-react";
import {
  lockWalkInLink,
  unlockWalkInLink,
  type UnlockState,
} from "@/lib/walk-in-link-actions";
import { PublicWalkInForm } from "@/components/public-walk-in-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WalkInLinkType } from "@/lib/walk-in-links";

const initialState: UnlockState = { ok: false };

/**
 * The desk, in three screens.
 *
 * A visitor at a gate cannot be expected to know a passcode, so the passcode
 * unlocks the *device* once — then it sits on "New entry" between visitors,
 * which is the state a shared tablet should rest in. Each submission returns
 * here rather than leaving the last person's details on screen.
 */
export function PublicWalkInGate({
  slug,
  linkType,
  extraFields,
  projectName,
  unlocked,
}: {
  slug: string;
  linkType: WalkInLinkType;
  extraFields: string[];
  projectName: string | null;
  unlocked: boolean;
}) {
  const [open, setOpen] = useState(unlocked);
  const [capturing, setCapturing] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  // The server may end the session under us — a paused link, an expiry, a
  // twelve-hour-old cookie — and the submit action says so.
  useEffect(() => {
    if (!unlocked) {
      setOpen(false);
      setCapturing(false);
    }
  }, [unlocked]);

  if (!open) {
    return <PasscodeGate slug={slug} onUnlocked={() => setOpen(true)} />;
  }

  if (capturing) {
    return (
      <PublicWalkInForm
        slug={slug}
        linkType={linkType}
        extraFields={extraFields}
        projectName={projectName}
        onSaved={(message) => {
          setLastSaved(message);
          setCapturing(false);
        }}
        onCancel={() => setCapturing(false)}
      />
    );
  }

  return (
    <div className="flex flex-col items-center gap-5 py-6 text-center">
      {lastSaved && (
        <Alert>
          <AlertTitle>Saved</AlertTitle>
          <AlertDescription>{lastSaved}</AlertDescription>
        </Alert>
      )}

      <div>
        <p className="text-sm font-semibold">Ready for the next visitor</p>
        <p className="mt-1 text-xs text-muted-foreground">
          This device is unlocked. Start an entry when somebody arrives.
        </p>
      </div>

      <Button size="lg" className="w-full max-w-xs" onClick={() => setCapturing(true)}>
        <UserPlus />
        New entry
      </Button>

      <form action={lockWalkInLink}>
        <input type="hidden" name="slug" value={slug} />
        <button
          type="submit"
          className="flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          <Lock className="size-3" />
          Lock this device
        </button>
      </form>
    </div>
  );
}

function PasscodeGate({ slug, onUnlocked }: { slug: string; onUnlocked: () => void }) {
  const [state, action, pending] = useActionState(unlockWalkInLink, initialState);

  useEffect(() => {
    if (state.ok) onUnlocked();
  }, [state.ok, onUnlocked]);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="slug" value={slug} />

      {state.message && !state.ok && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Locked</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="passcode" className="flex items-center gap-1.5">
          <KeyRound className="size-3.5" />
          Passcode
        </Label>
        <Input
          id="passcode"
          name="passcode"
          type="password"
          required
          autoFocus
          autoComplete="off"
          inputMode="numeric"
          placeholder="Ask the team for today's code"
        />
        <p className="text-xs text-muted-foreground">
          Entered once per device. It stays unlocked for the shift.
        </p>
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Checking…" : "Unlock"}
      </Button>
    </form>
  );
}
