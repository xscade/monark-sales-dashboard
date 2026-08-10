import Link from "next/link";
import { redirect } from "next/navigation";
import { can, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Application shell.
 *
 * Navigation is grouped by who actually uses it, not by data model:
 * salespeople live in Leads / Pipeline / Walk-ins, marketing in Campaigns /
 * Conversions, management in Overview. Items a role cannot use are hidden
 * rather than shown-and-denied — an agent has no reason to see a Campaign Spend
 * link they will only bounce off.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  async function signOut() {
    "use server";
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  const nav = [
    { href: "/", label: "Overview", show: true },
    { href: "/leads", label: "Leads", show: can(user, "leads:read") },
    { href: "/pipeline", label: "Pipeline", show: can(user, "leads:read") },
    { href: "/walk-ins", label: "Walk-ins", show: can(user, "visits:write") },
    { href: "/campaigns", label: "Campaigns", show: can(user, "campaigns:read") },
    { href: "/conversions", label: "Conversion Sync", show: can(user, "conversions:read") },
    { href: "/settings", label: "Settings", show: can(user, "settings:write") },
  ].filter((i) => i.show);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
        <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-2.5">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-sm font-semibold text-white">
              M
            </span>
            <span className="hidden text-sm font-semibold sm:block">{user.orgName}</span>
          </Link>

          <nav className="flex flex-1 items-center gap-0.5 overflow-x-auto">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-xs font-medium leading-tight">{user.name}</p>
              <p className="text-[11px] capitalize leading-tight text-zinc-500">
                {user.role.replace(/_/g, " ")}
              </p>
            </div>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-600 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-6">{children}</main>
    </div>
  );
}
