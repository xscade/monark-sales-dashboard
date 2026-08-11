import { redirect } from "next/navigation";
import { AppShell, type ShellNavSection } from "@/components/app-shell";
import { can, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  async function signOut() {
    "use server";
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  const sections = [
    {
      label: "Command centre",
      items: [
        { href: "/", label: "Overview", show: true },
        { href: "/today", label: "Today", show: can(user, "tasks:read") },
      ],
    },
    {
      label: "Sales",
      items: [
        { href: "/leads", label: "Leads", show: can(user, "leads:read") },
        { href: "/pipeline", label: "Pipeline", show: can(user, "leads:read") },
        { href: "/customers", label: "Customers", show: can(user, "customers:read") },
        { href: "/follow-ups", label: "Follow-ups", show: can(user, "tasks:read") },
        { href: "/tasks", label: "Tasks", show: can(user, "tasks:read") },
      ],
    },
    {
      label: "Field operations",
      items: [
        { href: "/walk-ins", label: "Walk-ins", show: can(user, "visits:read") },
        { href: "/site-visits", label: "Site visits", show: can(user, "visits:read") },
      ],
    },
    {
      label: "Commercial",
      items: [
        { href: "/inventory", label: "Inventory", show: can(user, "inventory:read") },
        { href: "/bookings", label: "Bookings & payments", show: can(user, "bookings:read") },
        { href: "/accounts", label: "Accounts", show: can(user, "accounts:read") },
      ],
    },
    {
      label: "Intelligence",
      items: [
        { href: "/campaigns", label: "Campaign intelligence", show: can(user, "campaigns:read") },
        { href: "/conversions", label: "Conversion sync", show: can(user, "conversions:read") },
        { href: "/reports", label: "Reports", show: can(user, "reports:read") },
      ],
    },
    {
      label: "Workspace",
      items: [{ href: "/settings", label: "Settings", show: can(user, "settings:write") }],
    },
  ]
    .map((section) => ({
      label: section.label,
      items: section.items.filter((item) => item.show).map(({ href, label }) => ({ href, label })),
    }))
    .filter((section) => section.items.length > 0) satisfies ShellNavSection[];

  // Capture is one form now, so "Add lead" and the old "Check in" pointed at
  // the same place. The second slot goes to site visits, which is the screen
  // people actually wanted when they reached for check-in.
  const quickActions = [
    ...(can(user, "visits:write") ? [{ href: "/walk-ins/new", label: "Add lead" }] : []),
    ...(can(user, "visits:read") ? [{ href: "/site-visits", label: "Site visit" }] : []),
  ];

  return (
    <AppShell
      user={{
        name: user.name,
        email: user.email,
        role: user.role,
        orgName: user.orgName,
        orgId: user.orgId,
      }}
      sections={sections}
      quickActions={quickActions}
      signOutAction={signOut}
    >
      {children}
    </AppShell>
  );
}
