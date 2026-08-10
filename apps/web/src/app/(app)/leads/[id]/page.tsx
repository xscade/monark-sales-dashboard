import Link from "next/link";
import { notFound } from "next/navigation";
import { LEAD_STAGES, TERMINAL_STAGES } from "@monark/core";
import { requireUser } from "@/lib/auth";
import { getLeadDetail, listAgents } from "@/lib/queries";
import { assignLead, changeStage, checkInVisit, logActivity } from "@/lib/actions";
import { AttributionClock, Card, EmptyState, SourceBadge, StageBadge, SubmitButton } from "@/components/ui";
import {
  formatDateTime,
  formatDuration,
  formatINR,
  formatRelative,
  stageLabel,
} from "@/lib/format";

export const dynamic = "force-dynamic";

/** One merged, chronological stream. Sales think in "what happened, in order",
 *  not in four separate tables. */
type TimelineItem = {
  at: Date;
  kind: "touchpoint" | "stage" | "activity" | "visit";
  title: string;
  detail?: string | null;
  meta?: string | null;
};

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const [data, agents] = await Promise.all([
    getLeadDetail(user.orgId, id),
    listAgents(user.orgId),
  ]);
  if (!data) notFound();

  const { lead, touchpoints, history, activities, visits, qualification } = data;
  const firstTouch = touchpoints[0];

  const timeline: TimelineItem[] = [
    ...touchpoints.map((t) => ({
      at: new Date(t.occurred_at),
      kind: "touchpoint" as const,
      title: `Enquiry via ${String(t.source).replace(/_/g, " ")}`,
      detail: [t.campaign_name, t.creative_name, t.keyword].filter(Boolean).join(" · ") || null,
      meta: t.landing_page,
    })),
    ...history.map((h) => ({
      at: new Date(h.created_at),
      kind: "stage" as const,
      title: h.from_stage
        ? `${stageLabel(h.from_stage)} → ${stageLabel(h.to_stage)}`
        : `Stage set to ${stageLabel(h.to_stage)}`,
      detail: h.reason,
      meta: [h.changed_by, h.duration_in_previous_seconds ? `after ${formatDuration(h.duration_in_previous_seconds)}` : null]
        .filter(Boolean)
        .join(" · ") || null,
    })),
    ...activities.map((a) => ({
      at: new Date(a.occurred_at),
      kind: "activity" as const,
      title: a.type === "call" ? `Call — ${a.call_outcome ?? "logged"}` : a.type,
      detail: a.body,
      meta: a.user_name,
    })),
    ...visits.map((v) => ({
      at: new Date(v.arrived_at ?? v.scheduled_at),
      kind: "visit" as const,
      title: v.arrived_at
        ? `Visited — ${String(v.type).replace(/_/g, " ")}`
        : `Visit scheduled — ${String(v.type).replace(/_/g, " ")}`,
      detail: v.notes,
      meta: [v.host_name, v.accompanying_count ? `${v.accompanying_count} accompanying` : null]
        .filter(Boolean)
        .join(" · ") || null,
    })),
  ]
    .filter((i) => !Number.isNaN(i.at.getTime()))
    .sort((a, b) => b.at.getTime() - a.at.getTime());

  const dotClass: Record<TimelineItem["kind"], string> = {
    touchpoint: "bg-brand-500",
    stage: "bg-emerald-500",
    activity: "bg-zinc-400",
    visit: "bg-amber-500",
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/leads" className="text-xs text-zinc-500 hover:underline">
            ← Leads
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{lead.full_name ?? "Unnamed lead"}</h1>
          <p className="tabular mt-0.5 text-sm text-zinc-500">
            {lead.primary_phone ?? "—"}
            {lead.primary_email ? ` · ${lead.primary_email}` : ""} · {lead.reference}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StageBadge stage={lead.stage_text} />
          {lead.is_nri && (
            <span className="rounded-md bg-violet-100 px-2 py-0.5 text-xs text-violet-700 dark:bg-violet-950 dark:text-violet-300">
              NRI
            </span>
          )}
          {lead.is_suppressed && (
            <span className="rounded-md bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
              Do not contact
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Timeline" subtitle={`${timeline.length} events`}>
            {timeline.length === 0 ? (
              <EmptyState title="Nothing logged yet" />
            ) : (
              <ol className="relative space-y-0 px-5 py-4">
                {timeline.map((item, i) => (
                  <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
                    <div className="flex flex-col items-center">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotClass[item.kind]}`} />
                      {i < timeline.length - 1 && (
                        <span className="mt-1 w-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-medium capitalize">{item.title}</p>
                        <time className="shrink-0 text-xs text-zinc-500" dateTime={item.at.toISOString()}>
                          {formatDateTime(item.at)}
                        </time>
                      </div>
                      {item.detail && (
                        <p className="mt-0.5 whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-400">
                          {item.detail}
                        </p>
                      )}
                      {item.meta && <p className="mt-0.5 truncate text-xs text-zinc-500">{item.meta}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card title="Log activity">
            <form action={logActivity} className="space-y-3 p-5">
              <input type="hidden" name="leadId" value={lead.id} />
              <div className="flex flex-wrap gap-2">
                <select
                  name="type"
                  className="rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                >
                  <option value="call">Call</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="note">Note</option>
                  <option value="email">Email</option>
                  <option value="meeting">Meeting</option>
                </select>
                <select
                  name="callOutcome"
                  className="rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                >
                  <option value="">Outcome…</option>
                  <option value="connected">Connected</option>
                  <option value="no_answer">No answer</option>
                  <option value="busy">Busy</option>
                  <option value="switched_off">Switched off</option>
                  <option value="invalid">Invalid number</option>
                </select>
                <input
                  type="datetime-local"
                  name="nextFollowUpAt"
                  title="Next follow-up"
                  className="rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                />
              </div>
              <textarea
                name="body"
                rows={3}
                placeholder="What happened? Objections, budget, family situation…"
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-700 dark:bg-zinc-950"
              />
              <SubmitButton>Save activity</SubmitButton>
            </form>
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Attribution" subtitle="Frozen at first touch — never overwritten">
            {!firstTouch ? (
              <EmptyState title="No touchpoint recorded" />
            ) : (
              <dl className="space-y-2.5 px-5 py-4 text-sm">
                <Row label="Source">
                  <SourceBadge source={firstTouch.source} platform={firstTouch.ad_platform} />
                </Row>
                <Row label="Campaign">{firstTouch.campaign_name ?? "—"}</Row>
                <Row label="Ad set">{firstTouch.adset_name ?? "—"}</Row>
                <Row label="Creative">{firstTouch.creative_name ?? firstTouch.ad_name ?? "—"}</Row>
                <Row label="Keyword">{firstTouch.keyword ?? "—"}</Row>
                <Row label="Click ID">
                  <span className="tabular text-xs">
                    {firstTouch.gclid
                      ? "gclid"
                      : firstTouch.gbraid
                        ? "gbraid"
                        : firstTouch.wbraid
                          ? "wbraid"
                          : firstTouch.ctwa_clid
                            ? "ctwa"
                            : firstTouch.fbclid
                              ? "fbclid"
                              : "none"}
                  </span>
                </Row>
                <Row label="Google window">
                  <AttributionClock expiresAt={firstTouch.attribution_expires_at} />
                </Row>
                <Row label="First touch">{formatRelative(firstTouch.occurred_at)}</Row>
              </dl>
            )}
          </Card>

          <Card title="Move stage">
            <form action={changeStage} className="space-y-3 p-5">
              <input type="hidden" name="leadId" value={lead.id} />
              <select
                name="toStage"
                defaultValue=""
                required
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              >
                <option value="" disabled>
                  Select stage…
                </option>
                {[...LEAD_STAGES, ...TERMINAL_STAGES]
                  .filter((s) => s !== lead.stage_text)
                  .map((s) => (
                    <option key={s} value={s}>
                      {stageLabel(s)}
                    </option>
                  ))}
              </select>
              <input
                name="reason"
                placeholder="Reason (required when moving backwards or closing)"
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
              <SubmitButton>Update stage</SubmitButton>
              <p className="text-xs text-zinc-500">
                Moving to a stage that maps to a conversion queues it for Meta and Google.
              </p>
            </form>
          </Card>

          <Card title="Check in a visit">
            <form action={checkInVisit} className="space-y-3 p-5">
              <input type="hidden" name="leadId" value={lead.id} />
              <select
                name="visitType"
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              >
                <option value="corporate_office">Corporate office</option>
                <option value="project_site">Project site</option>
                <option value="experience_centre">Experience centre</option>
                <option value="virtual">Virtual</option>
              </select>
              <div className="flex gap-2">
                <input
                  name="accompanyingCount"
                  type="number"
                  min={0}
                  max={20}
                  placeholder="People with them"
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                />
                <select
                  name="intentRating"
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                >
                  <option value="">Intent…</option>
                  <option value="5">Very high</option>
                  <option value="4">High</option>
                  <option value="3">Medium</option>
                  <option value="2">Low</option>
                  <option value="1">Just looking</option>
                </select>
              </div>
              <textarea
                name="notes"
                rows={2}
                placeholder="Units shown, objections, next step…"
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
              <SubmitButton>Check in now</SubmitButton>
            </form>
          </Card>

          <Card title="Ownership">
            <form action={assignLead} className="space-y-3 p-5">
              <input type="hidden" name="leadId" value={lead.id} />
              <select
                name="toUserId"
                defaultValue={lead.owner_user_id ?? ""}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              >
                <option value="">Unassigned</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <SubmitButton variant="secondary">Reassign</SubmitButton>
            </form>
          </Card>

          {qualification && (
            <Card title="Qualification">
              <dl className="space-y-2.5 px-5 py-4 text-sm">
                <Row label="Quality">
                  <span className="capitalize">{String(qualification.quality).replace(/_/g, " ")}</span>
                </Row>
                <Row label="Budget">
                  {qualification.budget_min || qualification.budget_max
                    ? `${formatINR(qualification.budget_min, true)} – ${formatINR(qualification.budget_max, true)}`
                    : "—"}
                </Row>
                <Row label="Configuration">{qualification.desired_configuration ?? "—"}</Row>
                <Row label="Timeline">{qualification.purchase_timeline ?? "—"}</Row>
                <Row label="Funding">{qualification.funding_mode ?? "—"}</Row>
              </dl>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-xs text-zinc-500">{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  );
}
