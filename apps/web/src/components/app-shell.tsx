"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  Activity,
  AlarmClock,
  BadgeIndianRupee,
  BarChart3,
  BookOpenCheck,
  Boxes,
  Building2,
  CalendarCheck2,
  ChevronRight,
  CircleUserRound,
  ContactRound,
  Gauge,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Menu,
  Moon,
  PanelsTopLeft,
  Plus,
  Settings2,
  Sparkles,
  Sun,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export interface ShellNavItem {
  href: string;
  label: string;
}

export interface ShellNavSection {
  label: string;
  items: ShellNavItem[];
}

interface AppShellProps {
  children: React.ReactNode;
  user: {
    name: string;
    email: string;
    role: string;
    orgName: string;
  };
  sections: ShellNavSection[];
  quickActions: ShellNavItem[];
  signOutAction: () => Promise<void>;
}

const ICONS: Record<string, LucideIcon> = {
  "/": LayoutDashboard,
  "/today": CalendarCheck2,
  "/leads": ContactRound,
  "/pipeline": PanelsTopLeft,
  "/customers": UsersRound,
  "/follow-ups": AlarmClock,
  "/tasks": ListTodo,
  "/walk-ins": CircleUserRound,
  "/site-visits": Building2,
  "/inventory": Boxes,
  "/bookings": BookOpenCheck,
  "/accounts": BadgeIndianRupee,
  "/campaigns": BarChart3,
  "/conversions": Activity,
  "/reports": Gauge,
  "/settings": Settings2,
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function isCurrent(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function NavContent({
  sections,
  pathname,
  close,
}: {
  sections: ShellNavSection[];
  pathname: string;
  close?: () => void;
}) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 pb-4 pt-2" aria-label="Primary navigation">
      {sections.map((section) => (
        <div key={section.label} className="mb-5">
          <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.17em] text-sidebar-foreground/45">
            {section.label}
          </p>
          <div className="space-y-0.5">
            {section.items.map((item) => {
              const active = isCurrent(pathname, item.href);
              const Icon = ICONS[item.href] ?? ChevronRight;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={close}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/68 hover:bg-sidebar-accent/65 hover:text-sidebar-accent-foreground",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="active-navigation"
                      className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-sidebar-primary"
                      transition={{ type: "spring", bounce: 0.15, duration: 0.45 }}
                    />
                  )}
                  <Icon className={cn("size-[18px]", active ? "text-sidebar-primary" : "opacity-75")} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex h-[72px] items-center gap-3 px-5">
      <span className="relative flex size-9 items-center justify-center overflow-hidden rounded-xl bg-sidebar-primary text-sm font-black text-sidebar-primary-foreground shadow-[0_8px_24px_rgba(52,211,153,.18)]">
        M
        <span className="absolute -right-1 -top-1 size-3 rounded-full bg-amber-300/85" />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-bold tracking-tight text-sidebar-foreground">Monark</span>
        <span className="block text-[10px] font-semibold uppercase tracking-[0.17em] text-sidebar-foreground/45">
          Sales intelligence
        </span>
      </span>
    </Link>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="text-muted-foreground"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Use light theme" : "Use dark theme"}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}

export function AppShell({ children, user, sections, quickActions, signOutAction }: AppShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeLabel = useMemo(
    () =>
      sections
        .flatMap((section) => section.items)
        .find((item) => isCurrent(pathname, item.href))?.label ?? "Workspace",
    [pathname, sections],
  );

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[260px] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <Brand />
        <NavContent sections={sections} pathname={pathname} />
        <div className="border-t border-sidebar-border p-3">
          <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/50 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-sidebar-foreground">
              <Sparkles className="size-3.5 text-sidebar-primary" />
              Live attribution
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-sidebar-foreground/52">
              CRM outcomes are connected to campaign touchpoints.
            </p>
          </div>
        </div>
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[292px] gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="flex items-center justify-between border-b border-sidebar-border pr-3">
            <Brand />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              onClick={() => setMobileOpen(false)}
            >
              <X />
              <span className="sr-only">Close navigation</span>
            </Button>
          </div>
          <NavContent sections={sections} pathname={pathname} close={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="lg:pl-[260px]">
        <header className="sticky top-0 z-30 border-b bg-background/88 backdrop-blur-xl supports-[backdrop-filter]:bg-background/78">
          <div className="flex h-[68px] items-center gap-3 px-4 sm:px-6 lg:px-8">
            <Button type="button" variant="outline" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)}>
              <Menu />
              <span className="sr-only">Open navigation</span>
            </Button>

            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {user.orgName}
              </p>
              {/* The page title lives here, once. Pages whose own heading
                  would only repeat this one have had it removed, so this has
                  to be the real heading rather than decorative text. */}
              <h1 className="truncate text-sm font-semibold tracking-tight sm:text-base">{activeLabel}</h1>
            </div>

            <div className="hidden items-center gap-2 sm:flex">
              {quickActions.slice(0, 2).map((item, index) => (
                <Button key={item.href} asChild variant={index === 0 ? "default" : "outline"} size="sm">
                  <Link href={item.href}>
                    {/* Both are create actions, so both lead with the plus; the
                        second keeps its own icon so the two stay tellable
                        apart at a glance. */}
                    <Plus />
                    {index === 0 ? null : <Building2 />}
                    {item.label}
                  </Link>
                </Button>
              ))}
            </div>

            {quickActions[0] && (
              <Button asChild size="icon" className="sm:hidden">
                <Link href={quickActions[0].href} aria-label={quickActions[0].label}><Plus /></Link>
              </Button>
            )}

            <ThemeToggle />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" className="h-10 gap-2 px-1.5 sm:px-2" aria-label="Open account menu">
                  <Avatar className="size-8 border border-border">
                    <AvatarFallback className="bg-primary/10 text-xs font-bold text-primary">
                      {initials(user.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden max-w-32 text-left md:block">
                    <span className="block truncate text-xs font-semibold">{user.name}</span>
                    <span className="block truncate text-[10px] capitalize text-muted-foreground">
                      {user.role.replace(/_/g, " ")}
                    </span>
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="font-normal">
                  <p className="truncate text-sm font-semibold">{user.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <form action={signOutAction}>
                  <button
                    type="submit"
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus:bg-accent"
                  >
                    <LogOut className="size-4" />
                    Sign out
                  </button>
                </form>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <motion.main
          key={pathname}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto w-full max-w-[1680px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8"
        >
          {children}
        </motion.main>
      </div>
    </div>
  );
}
