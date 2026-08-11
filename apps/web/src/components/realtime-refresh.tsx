"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserClient } from "@/lib/supabase/browser";

/** Coalesce a burst of writes — one capture touches lead, visit and activity. */
const DEBOUNCE_MS = 400;
/**
 * Safety net, not the mechanism.
 *
 * Websockets drop: laptops sleep, phones change cell, proxies time out. A sales
 * board that silently stopped updating would be worse than one that never
 * promised to, because people stop reloading once they trust it. This is
 * deliberately slow — Realtime does the real work, and this only catches the
 * case where Realtime is not working at all.
 */
const FALLBACK_POLL_MS = 60_000;

/**
 * Keeps the dashboard current without anyone pressing reload.
 *
 * On a signal it calls `router.refresh()`, which re-runs the Server Components
 * for the current route. That is the important part: no lead data arrives over
 * the socket, so a stale or over-broad subscription cannot leak anything. The
 * refresh goes through `requireUser` and the module permissions like any other
 * request, and the user sees exactly what they were always allowed to see.
 *
 * Refreshes are skipped while the tab is hidden and run once on the way back,
 * so a laptop left open overnight is not re-rendering a CRM to nobody.
 */
export function RealtimeRefresh({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [live, setLive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Kept in a ref so the subscribe effect never re-runs when it flips.
  const dirty = useRef(false);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "hidden") {
        dirty.current = true;
        return;
      }
      dirty.current = false;
      router.refresh();
    };

    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(refresh, DEBOUNCE_MS);
    };

    const onVisible = () => {
      // Coming back to the tab is itself a reason to refetch: whatever arrived
      // while it was hidden is exactly what the user is returning to check.
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);

    const poll = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, FALLBACK_POLL_MS);

    const supabase = getBrowserClient();
    if (!supabase) {
      return () => {
        document.removeEventListener("visibilitychange", onVisible);
        window.removeEventListener("online", refresh);
        clearInterval(poll);
        if (timer.current) clearTimeout(timer.current);
      };
    }

    // A private channel authorises against realtime.messages using the user's
    // own token, not the anon key the client was built with. setAuth resolves
    // asynchronously, so the join has to wait for it — subscribing first means
    // presenting the anon key and being refused.
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    void supabase.realtime.setAuth().then(() => {
      if (cancelled) return;
      channel = supabase
        .channel(`org:${orgId}`, { config: { private: true } })
        .on("broadcast", { event: "change" }, schedule)
        .subscribe((status) => {
          setLive(status === "SUBSCRIBED");
        });
    });

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
      clearInterval(poll);
      if (timer.current) clearTimeout(timer.current);
      if (channel) supabase.removeChannel(channel);
    };
  }, [orgId, router]);

  // Whether the board is genuinely live is worth stating rather than implying.
  // Someone deciding not to reload before a callback should be able to see that
  // the connection is actually up.
  return (
    <span
      title={live ? "Live — new leads appear automatically" : "Reconnecting; checking every minute"}
      className="hidden items-center gap-1.5 text-[11px] font-medium text-muted-foreground sm:inline-flex"
    >
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${live ? "bg-emerald-500" : "bg-amber-500"}`}
      />
      {live ? "Live" : "Reconnecting"}
    </span>
  );
}
