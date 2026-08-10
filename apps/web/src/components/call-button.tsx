"use client";

import { useState } from "react";
import { Check, Copy, Phone, Smartphone } from "lucide-react";
import type { CallTarget } from "@/lib/call";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Call control that adapts to the device it is clicked on.
 *
 * On a phone the anchor does what anchors do — `tel:` hands off to the dialler.
 * On a desktop that link is a dead end (at best it launches a softphone nobody
 * has configured), so instead of pretending, the click opens a QR code: the
 * salesperson points their own phone at the screen and the call starts there.
 *
 * The branch is decided at click time, not render time, so the markup is
 * identical on server and client, and with JavaScript off the anchor still
 * carries a working `tel:` href.
 */
export function CallButton({
  target,
  name,
  className,
}: {
  target: CallTarget;
  name: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyNumber() {
    try {
      await navigator.clipboard.writeText(target.e164);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied — the number is on screen to be typed.
    }
  }

  return (
    <>
      <a
        href={target.tel}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey) return;
          if (window.matchMedia("(hover: none) and (pointer: coarse)").matches) return;
          event.preventDefault();
          setOpen(true);
        }}
        className={
          className ??
          "flex items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        }
      >
        <Phone aria-hidden className="size-3.5" />
        Call
      </a>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Call {name}</DialogTitle>
            <DialogDescription>
              Scan this with your phone&rsquo;s camera — it opens the dialler with the number
              already filled in.
            </DialogDescription>
          </DialogHeader>

          {/* The viewBox leaves four spare modules on every side — the quiet
              zone the spec asks for, without which some scanners never lock on.
              The white plate stays white in dark mode for the same reason. */}
          <div className="flex justify-center">
            <svg
              viewBox={`-4 -4 ${target.qrSize + 8} ${target.qrSize + 8}`}
              role="img"
              aria-label={`QR code that dials ${target.display}`}
              className="size-52 rounded-lg bg-white p-2 shadow-xs ring-1 ring-black/5"
              shapeRendering="crispEdges"
            >
              <path d={target.qrPath} fill="#000000" />
            </svg>
          </div>

          <div className="text-center">
            <p className="tabular text-lg font-semibold tracking-tight">{target.display}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Country code {target.countryCode} included, so the scan dials correctly from any
              network.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={copyNumber}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition hover:bg-muted"
            >
              {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
              {copied ? "Copied" : "Copy number"}
            </button>
            <a
              href={target.tel}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
            >
              <Smartphone aria-hidden className="size-4" />
              Call from this device
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
