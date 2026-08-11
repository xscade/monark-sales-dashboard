import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client, used for exactly one thing: subscribing to the
 * org's Realtime channel.
 *
 * It never reads a table. It cannot, in fact — migration 0002 revoked every
 * privilege on `public` from the anon and authenticated roles, so PostgREST
 * from the browser returns nothing. All CRM data still arrives the same way it
 * always has: rendered on the server, behind the permission checks.
 */
let client: ReturnType<typeof createBrowserClient> | null = null;

export function getBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  // One socket per tab, not one per component that wants updates.
  client ??= createBrowserClient(url, anonKey);
  return client;
}
