import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDb, users } from "@monark/db";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

async function signIn(formData: FormData) {
  "use server";

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const requestedNext = String(formData.get("next") ?? "/");
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//")
    ? requestedNext
    : "/";

  if (!email || !password) {
    redirect(`/login?error=${encodeURIComponent("Email and password are required")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Deliberately generic. Distinguishing "no such user" from "wrong password"
    // turns the login form into an account-enumeration oracle.
    redirect(`/login?error=${encodeURIComponent("Invalid email or password")}`);
  }

  // A valid Supabase session is not access. Confirm the person has an active
  // row in our users table before letting them through, and sign them straight
  // back out if not — otherwise they'd sit in a redirect loop with a live
  // session and no idea why.
  const db = getDb();
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), eq(users.isActive, true)))
    .limit(1);

  if (!row) {
    await supabase.auth.signOut();
    redirect(
      `/login?error=${encodeURIComponent("This account has no access to Monark. Ask an administrator to add you.")}`,
    );
  }

  redirect(next);
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-lg font-semibold text-white">
            M
          </div>
          <h1 className="text-lg font-semibold">Monark Sales Intelligence</h1>
          <p className="mt-1 text-sm text-zinc-500">Sign in to continue</p>
        </div>

        <form
          action={signIn}
          className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          {params.error && (
            <p
              role="alert"
              className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300"
            >
              {params.error}
            </p>
          )}

          <input type="hidden" name="next" value={params.next ?? "/"} />

          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:ring-brand-700/30"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:ring-brand-700/30"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-brand-600 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700"
          >
            Sign in
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-zinc-400">
          Access and invitations are managed by a Monark administrator.
        </p>
      </div>
    </div>
  );
}
