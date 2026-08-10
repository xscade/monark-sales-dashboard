import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Supabase client bound to the request's cookies.
 *
 * Uses the ANON key deliberately, never the service-role key. The anon key
 * respects Row Level Security; the service-role key bypasses it entirely and
 * would turn any injection or logic slip in a Server Component into full
 * database access. The service-role key has no place in request-scoped code.
 *
 * Note this client is used ONLY for authentication. All CRM reads and writes go
 * through Drizzle over the pooled Postgres connection, because they need joins,
 * transactions, and the conversion outbox — none of which PostgREST gives us.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // The middleware refreshes the session, so this is safe to ignore.
          }
        },
      },
    },
  );
}
