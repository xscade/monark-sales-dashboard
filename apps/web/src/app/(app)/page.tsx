import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck2,
  Clock3,
  ContactRound,
  IndianRupee,
  Plus,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  UserRoundCheck,
} from "lucide-react";
import { can, requireUser } from "@/lib/auth";
import {
  getAgentPerformance,
  getExpiringAttribution,
  getFunnel,
  getOverviewStats,
  getOverviewTrend,
} from "@/lib/queries";
import { OverviewTrendChart } from "@/components/overview-trend-chart";
import { StageBadge } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatDuration, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function Metric({
  label,
  value,
  detail,
  href,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: string;
  href?: string;
  icon: typeof ContactRound;
  tone?: "default" | "good" | "warn" | "danger";
}) {
  const colors = {
    default: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
    good: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
    warn: "bg-amber-500/14 text-amber-700 dark:text-amber-300",
    danger: "bg-red-500/12 text-red-700 dark:text-red-300",
  }[tone];
  const content = (
    <Card className={cn("h-full gap-3 py-4 shadow-[0_1px_2px_rgba(15,23,42,.04)] transition", href && "hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md")}>
      <CardContent className="px-4 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">{label}</p>
            <p className="tabular mt-2 text-2xl font-bold tracking-[-0.035em] sm:text-[1.75rem]">{value}</p>
          </div>
          <span className={cn("flex size-9 items-center justify-center rounded-xl", colors)}>
            <Icon className="size-[18px]" />
          </span>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

export default async function OverviewPage() {
  const user = await requireUser();
  const personalOwnerId = user.role === "sales_agent" ? user.id : undefined;
  const [stats, funnel, trend, expiring, agents] = await Promise.all([
    getOverviewStats(user.orgId, user.timezone, personalOwnerId),
    getFunnel(user.orgId, 90, personalOwnerId),
    getOverviewTrend(user.orgId, user.timezone, 30, personalOwnerId),
    getExpiringAttribution(user.orgId, 8, personalOwnerId),
    can(user, "reports:read") ? getAgentPerformance(user.orgId) : Promise.resolve([]),
  ]);

  const firstName = user.name.split(/\s+/)[0] || user.name;
  const top = funnel[0]?.leads ?? 0;

  return (
    <div className="space-y-6 sm:space-y-8">
      <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <Badge variant="secondary" className="mb-2 gap-1.5 border-0 text-[10px] uppercase tracking-wider">
            <Sparkles className="size-3 text-primary" />
            Live sales command centre
          </Badge>
          <h2 className="text-2xl font-bold tracking-[-0.035em] sm:text-3xl">Good to see you, {firstName}.</h2>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            Here is what needs attention today and how the last 30 days are converting.
          </p>
        </div>
        <div className="flex gap-2">
          {can(user, "visits:write") && (
            <Button asChild variant="outline">
              <Link href="/walk-ins/new"><CalendarCheck2 />Check in visitor</Link>
            </Button>
          )}
          {can(user, "leads:write") && (
            <Button asChild>
              <Link href="/walk-ins/new"><Plus />Add lead</Link>
            </Button>
          )}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric label="Leads today" value={formatNumber(stats.leadsToday ?? 0)} detail="New opportunities captured" icon={ContactRound} />
        <Metric label="Unworked" value={formatNumber(stats.unworked ?? 0)} detail="Still waiting for first action" href="/leads?stage=new" icon={Clock3} tone={(stats.unworked ?? 0) > 0 ? "warn" : "good"} />
        {/* `from=overview` is what makes the follow-ups page lead with the
            overdue toggle — the visitor arrived having already asked that
            question, and the answer should not be three clicks away. */}
        <Metric label="Overdue follow-ups" value={formatNumber(stats.overdue ?? 0)} detail="Due before the current time" href="/follow-ups?from=overview" icon={ShieldAlert} tone={(stats.overdue ?? 0) > 0 ? "danger" : "good"} />
        {/* The detail line carries the verification split rather than spending
            a fifth tile on it: "8 bookings" and "8 bookings, 2 of which
            accounts has actually seen the money for" are the same headline
            with very different meanings. */}
        <Metric
          label="Bookings · 30d"
          value={formatNumber(stats.bookings30d ?? 0)}
          detail={
            (stats.bookings30d ?? 0) > 0
              ? `${formatNumber(stats.validatedBookings30d ?? 0)} validated by accounts`
              : "Confirmed commercial outcomes"
          }
          href="/bookings"
          icon={IndianRupee}
          tone="good"
        />
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,.7fr)]">
        <Card className="gap-3 overflow-hidden py-0 shadow-sm">
          <CardHeader className="border-b py-5">
            <CardTitle className="text-base">Acquisition to outcome</CardTitle>
            <CardDescription>
              Daily lead capture, completed visits, bookings and the share accounts has validated
            </CardDescription>
            <CardAction className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-[#168f67]" />Leads</span>
              <span className="hidden items-center gap-1.5 sm:flex"><i className="size-2 rounded-full bg-[#d99d2a]" />Visits</span>
              <span className="hidden items-center gap-1.5 sm:flex"><i className="size-2 rounded-full bg-[#4679d8]" />Bookings</span>
              <span className="hidden items-center gap-1.5 sm:flex"><i className="h-0.5 w-3 rounded-full bg-[#0f9d6b]" />Validated</span>
            </CardAction>
          </CardHeader>
          <CardContent className="px-2 pb-4 pt-3 sm:px-5">
            <OverviewTrendChart data={trend} />
          </CardContent>
        </Card>

        <Card className="gap-0 py-0 shadow-sm">
          <CardHeader className="border-b py-5">
            <CardTitle className="flex items-center gap-2 text-base"><Clock3 className="size-4 text-amber-600" />Attribution clock</CardTitle>
            <CardDescription>Google click windows closing within 21 days</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {expiring.length === 0 ? (
              <div className="flex min-h-60 flex-col items-center justify-center px-6 text-center">
                <span className="flex size-11 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700"><UserRoundCheck className="size-5" /></span>
                <p className="mt-3 text-sm font-semibold">No windows closing soon</p>
                <p className="mt-1 text-xs text-muted-foreground">Your active leads have attribution runway.</p>
              </div>
            ) : (
              <div className="divide-y">
                {expiring.slice(0, 6).map((lead) => {
                  const days = Math.max(0, Math.floor((new Date(lead.expiresAt).getTime() - Date.now()) / 86_400_000));
                  return (
                    <Link key={lead.id} href={`/leads/${lead.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/55">
                      <span className={cn("tabular flex size-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold", days <= 7 ? "bg-red-500/10 text-red-700" : "bg-amber-500/12 text-amber-700")}>{days}d</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{lead.fullName ?? lead.reference}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{lead.campaignName ?? "Unknown campaign"}</span>
                      </span>
                      <ArrowRight className="size-4 text-muted-foreground" />
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(360px,1fr)]">
        <Card className="gap-0 py-0 shadow-sm">
          <CardHeader className="border-b py-5">
            <CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="size-4 text-primary" />Pipeline funnel</CardTitle>
            <CardDescription>Unique leads that reached each stage in the last 90 days</CardDescription>
            <CardAction><Button asChild variant="ghost" size="sm"><Link href="/pipeline">Open pipeline<ArrowRight /></Link></Button></CardAction>
          </CardHeader>
          <CardContent className="space-y-4 py-5">
            {funnel.map((row) => {
              const pct = top > 0 ? row.leads / top : 0;
              return (
                <div key={row.stage} className="grid grid-cols-[116px_minmax(80px,1fr)_74px] items-center gap-3">
                  <StageBadge stage={row.stage} />
                  <Progress value={pct * 100} className="h-2" />
                  <div className="tabular text-right text-xs"><span className="font-bold">{formatNumber(row.leads)}</span><span className="ml-1 text-muted-foreground">{formatPercent(pct, 0)}</span></div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="gap-0 py-0 shadow-sm">
          <CardHeader className="border-b py-5">
            <CardTitle className="text-base">Sales leaderboard</CardTitle>
            <CardDescription>Qualified follow-through over the last 30 days</CardDescription>
            <CardAction><Button asChild variant="ghost" size="sm"><Link href="/reports">Details<ArrowRight /></Link></Button></CardAction>
          </CardHeader>
          <CardContent className="px-0">
            {agents.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-muted-foreground">Performance appears as work is assigned.</p>
            ) : (
              <div className="divide-y">
                {agents.slice(0, 6).map((agent, index) => (
                  <div key={agent.id} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 px-5 py-3">
                    <span className={cn("tabular flex size-7 items-center justify-center rounded-full text-xs font-bold", index === 0 ? "bg-amber-400/20 text-amber-700" : "bg-muted text-muted-foreground")}>{index + 1}</span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{agent.name}</p>
                      <p className="text-[11px] text-muted-foreground">{agent.visits} visits · {formatDuration(agent.avgResponseSeconds)} response</p>
                    </div>
                    <div className="text-right"><p className="tabular text-sm font-bold">{agent.bookings}</p><p className="text-[10px] text-muted-foreground">bookings</p></div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
