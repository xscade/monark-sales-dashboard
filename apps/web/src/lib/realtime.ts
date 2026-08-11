import "server-only";

/**
 * Live change signals for the dashboard.
 *
 * What goes over the wire is a table name and nothing else. The client answers
 * a signal by asking Next.js to re-render, which runs the same `requireUser`
 * and permission checks any other request does — so the socket never becomes a
 * second, unguarded way to read the CRM. That is the whole design: Realtime
 * says "look again", the server decides what you are allowed to see.
 */
export const REALTIME_EVENT = "change";

export type ChangeKind = "leads" | "visits" | "bookings" | "accounts";

/** One private channel per organisation; see migration 0006 for who may join. */
export function orgChannel(orgId: string): string {
  return `org:${orgId}`;
}

/**
 * Publish over the Realtime REST API rather than from a database trigger.
 *
 * `realtime.send()` in Postgres writes to `realtime.messages`, which on this
 * project is a partitioned table with no partitions — the insert fails and the
 * function downgrades it to a warning, so notifications vanish without a trace.
 * The REST endpoint publishes straight to subscribers and sidesteps that
 * entirely. Migration 0007 has the full account.
 */
export async function publishChange(orgId: string, kind: ChangeKind): Promise<void> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Not configured is not an error worth failing a booking over.
  if (!url || !serviceRole) return;

  try {
    // A signal is never worth holding a response open for. If Realtime is slow
    // or down, the write it was announcing has already committed and the
    // client's own polling safety net will catch up.
    const response = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic: orgChannel(orgId),
            event: REALTIME_EVENT,
            payload: { kind },
            private: true,
          },
        ],
      }),
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    if (!response.ok) {
      console.warn(`Realtime broadcast rejected: ${response.status}`);
    }
  } catch (error) {
    console.warn(
      "Realtime broadcast failed",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}
