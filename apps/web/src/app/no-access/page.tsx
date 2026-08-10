import { redirect } from "next/navigation";
import { getAuthUser, getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Signed in to Supabase, but not authorised for this CRM.
 *
 * Deliberately a real page rather than a redirect back to /login. Bouncing
 * these visitors to the login screen produced ERR_TOO_MANY_REDIRECTS, because
 * the middleware sends anyone holding a session away from /login. This page
 * terminates the cycle and tells them what is actually wrong.
 */
export default async function NoAccessPage() {
  const user = await getAuthUser();

  if (!user) redirect("/login");

  // This URL can be bookmarked. If access was granted since the visitor first
  // landed here, take them into the CRM instead of showing a stale denial.
  const crmUser = await getCurrentUser();
  if (crmUser) redirect("/");

  async function signOut() {
    "use server";
    const client = await createClient();
    await client.auth.signOut();
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-300 text-lg font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          M
        </div>
        <h1 className="text-lg font-semibold">No access to Monark</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-zinc-500">
          You are signed in as <span className="font-medium">{user.email}</span>, but that address
          has no active user in this CRM. An administrator needs to add it before you can sign in.
        </p>

        <form action={signOut} className="mt-6">
          <button
            type="submit"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Sign out and try another account
          </button>
        </form>
      </div>
    </div>
  );
}
