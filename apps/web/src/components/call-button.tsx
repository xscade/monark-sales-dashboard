"use client";

import { useState } from "react";
import { Check, Copy, MessageCircle, MessageSquare, Phone, Smartphone } from "lucide-react";
import {
  CONTACT_CHANNELS,
  CONTACT_CHANNEL_HINTS,
  CONTACT_CHANNEL_LABELS,
  type CallTarget,
  type ContactChannel,
} from "@/lib/contact-channels";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

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
const CHANNEL_ICONS: Record<ContactChannel, typeof Phone> = {
  call: Phone,
  whatsapp: MessageCircle,
  sms: MessageSquare,
};

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
  // A follow-up is a call by default; the other two are a click away rather
  // than a decision every time.
  const [channel, setChannel] = useState<ContactChannel>("call");
  const active = target.channels[channel];

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
        // Merged, not replaced: a caller that only wants to widen the control
        // should not have to restate the border, padding and hover state.
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800",
          className,
        )}
      >
        <Phone aria-hidden className="size-3.5" />
        Call
      </a>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{CONTACT_CHANNEL_LABELS[channel]} {name}</DialogTitle>
            <DialogDescription>
              Scan this with your phone&rsquo;s camera. {CONTACT_CHANNEL_HINTS[channel]}
            </DialogDescription>
          </DialogHeader>

          {/* Each channel encodes its own URI. A QR carrying only a number is
              read differently by every scanner — which is how a "call" ended up
              opening Messages. */}
          <div role="tablist" aria-label="Contact channel" className="flex gap-1 rounded-lg border p-1">
            {CONTACT_CHANNELS.map((option) => {
              const Icon = CHANNEL_ICONS[option];
              const selected = option === channel;
              return (
                <button
                  key={option}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setChannel(option)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition ${
                    selected ? "bg-brand-600 text-white" : "hover:bg-muted"
                  }`}
                >
                  <Icon aria-hidden className="size-3.5" />
                  {CONTACT_CHANNEL_LABELS[option]}
                </button>
              );
            })}
          </div>

          {/* The viewBox leaves four spare modules on every side — the quiet
              zone the spec asks for, without which some scanners never lock on.
              The white plate stays white in dark mode for the same reason. */}
          <div className="flex justify-center">
            <svg
              viewBox={`-4 -4 ${active.qrSize + 8} ${active.qrSize + 8}`}
              role="img"
              aria-label={`QR code that opens ${CONTACT_CHANNEL_LABELS[channel]} for ${target.display}`}
              className="size-52 rounded-lg bg-white p-2 shadow-xs ring-1 ring-black/5"
              shapeRendering="crispEdges"
            >
              <path d={active.qrPath} fill="#000000" />
            </svg>
          </div>

          <div className="text-center">
            <p className="tabular text-lg font-semibold tracking-tight">{target.display}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Country code {target.countryCode} included, so the scan reaches them from any
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
              href={active.uri}
              target={channel === "whatsapp" ? "_blank" : undefined}
              rel={channel === "whatsapp" ? "noreferrer" : undefined}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
            >
              <Smartphone aria-hidden className="size-4" />
              {CONTACT_CHANNEL_LABELS[channel]} from this device
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
