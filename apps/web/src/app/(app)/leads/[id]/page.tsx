import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { UserRound } from "lucide-react";
import { LEAD_STAGES } from "@monark/core";
import { can, requirePermission } from "@/lib/auth";
import { getLeadDetail, listActiveProjects, listAgents } from "@/lib/queries";
import { assignLead, checkInVisit, logActivity, updateLeadProject } from "@/lib/actions";
import { saveQualification } from "@/lib/qualification-actions";
import { Button } from "@/components/ui/button";
import { CallButton } from "@/components/call-button";
import { buildCallTarget } from "@/lib/call";
import { CollapsibleLogs } from "@/components/collapsible-logs";
import { Timeline } from "@/components/timeline";
import { isNoteworthyStageChange, sortTimeline, type TimelineEntry } from "@/lib/timeline";
import { LeadActions } from "@/components/lead-actions";
import { StageChangeForm } from "@/components/stage-change-form";
import { LeadCommercialPanel } from "@/components/lead-commercial-panel";
import { AttributionClock, Card, EmptyState, SourceBadge, StageBadge, SubmitButton } from "@/components/ui";
import {
  formatDuration,
  formatINR,
  formatRelative,
  stageLabel,
} from "@/lib/format";

export const dynamic = "force-dynamic";

/** One merged, chronological stream. Sales think in "what happened, in order",
 *  not in four separate tables. Rows that only restate another row are left out
 *  rather than shown — see lib/timeline.ts. */
type TimelineItem = TimelineEntry;

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("leads:read");
  const hasLeadWritePermission = can(user, "leads:write");
  const canAssign = can(user, "leads:assign");
  const { id } = await params;

  const [data, agents, activeProjects] = await Promise.all([
    getLeadDetail(user.orgId, id),
    canAssign ? listAgents(user.orgId) : Promise.resolve([]),
    hasLeadWritePermission ? listActiveProjects(user.orgId) : Promise.resolve([]),
  ]);
  if (!data) notFound();

  const { lead, touchpoints, history, assignments, activities, visits, qualification } = data;
  const isOwner = lead.owner_user_id === user.id;
  const isVisitHost = visits.some((visit) => visit.host_user_id === user.id);
  if (user.role === "sales_agent" && !isOwner && !isVisitHost) notFound();
  const writable = hasLeadWritePermission && (user.role !== "sales_agent" || isOwner);
  const canSeeCustomer = can(user, "customers:read");
  const callTarget = buildCallTarget(lead.primary_phone);
  const firstTouch = touchpoints[0];

  const timeline: TimelineItem[] = [
    // Only stage changes a person made and explained; the automatic ones just
    // restate the activity sitting next to them. See isNoteworthyStageChange.
    ...history.filter(isNoteworthyStageChange).map((h) => ({
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
    ...assignments.map((assignment) => ({
      at: new Date(assignment.created_at),
      kind: "assignment" as const,
      title: assignment.to_user_name ? `Assigned to ${assignment.to_user_name}` : "Lead unassigned",
      detail: assignment.reason,
      meta: [assignment.from_user_name ? `from ${assignment.from_user_name}` : null, assignment.rule]
        .filter(Boolean)
        .join(" · ") || null,
    })),
    ...activities.map((a) => ({
      at: new Date(a.occurred_at),
      kind: "activity" as const,
      // The subject is the only part that says what actually happened; without
      // it every follow-up task and note rendered as the bare word "task".
      title: a.subject ?? (a.type === "call" ? `Call — ${a.call_outcome ?? "logged"}` : a.type),
      detail: a.body,
      // The log is merged across the person's opportunities, so anything from
      // a different one says which — otherwise a booked deal's history looks
      // like it happened on this enquiry.
      meta: [a.user_name, a.lead_id !== lead.id ? `on ${a.lead_reference}` : null]
        .filter(Boolean)
        .join(" · ") || null,
    })),
    ...visits.map((v) => ({
      at: new Date(v.arrived_at ?? v.scheduled_at),
      kind: "visit" as const,
      title: v.arrived_at
        ? `Visited — ${String(v.type).replace(/_/g, " ")}`
        : `Visit scheduled — ${String(v.type).replace(/_/g, " ")}`,
      detail: [
        v.notes,
        Array.isArray(v.configurations_viewed) && v.configurations_viewed.length
          ? `Configurations: ${v.configurations_viewed.join(", ")}` : null,
        Array.isArray(v.units_viewed) && v.units_viewed.length
          ? `Plans / units: ${v.units_viewed.join(", ")}` : null,
        Array.isArray(v.objections) && v.objections.length
          ? `Objections: ${v.objections.join(", ")}` : null,
        v.next_action ? `Next: ${v.next_action}` : null,
      ].filter(Boolean).join("\n") || null,
      meta: [
        v.host_name,
        v.accompanying_count ? `${v.accompanying_count} accompanying` : null,
        Array.isArray(v.accompanying_relations) && v.accompanying_relations.length
          ? v.accompanying_relations.join(", ") : null,
        v.intent_rating ? `intent ${v.intent_rating}/5` : null,
        v.lead_id !== lead.id ? `on ${v.lead_reference}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || null,
    })),
  ];

  const events = sortTimeline(timeline);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/leads" className="text-xs text-zinc-500 hover:underline">
            ← Leads
          </Link>
          <h2 className="mt-1 text-xl font-semibold">{lead.full_name ?? "Unnamed lead"}</h2>
          <p className="tabular mt-0.5 text-sm text-zinc-500">
            {lead.primary_phone ?? "—"}
            {lead.primary_email ? ` · ${lead.primary_email}` : ""} · {lead.reference}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
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
          {/* This page is one enquiry; the person may have several. Without a
              way across, the same buyer reads as two unrelated records
              depending on which screen you happened to open. */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* The number is on the page, but reaching for it meant reading it
                off and typing it into a phone. Same control the follow-up
                queue uses, so calling works the same way wherever you are. */}
            {callTarget && (
              <CallButton
                target={callTarget}
                name={lead.full_name ?? lead.reference}
                // Matches Button size="sm" so it lines up with View customer.
                className="h-8 rounded-md px-3 text-sm"
              />
            )}
            {canSeeCustomer && (
              <Button asChild size="sm">
                <Link href={`/customers/${lead.person_id}`}>
                  <UserRound />
                  View customer
                </Link>
              </Button>
            )}
            {writable && (
              <LeadActions
                leadId={lead.id}
                leadName={lead.full_name ?? lead.reference}
                stage={lead.stage_text}
                compact
              />
            )}
          </div>
        </div>
      </div>

      {/* Full width and outside the balanced flow below: the log is long, and
          collapsed by default so it never buries the actionable cards. */}
      <CollapsibleLogs count={events.length}>
            <Timeline entries={events} />
      </CollapsibleLogs>

      {/*
        Everything below is a self-contained card of unpredictable height, so a
        fixed two-column split always stranded one side: six cards on the right
        against two on the left left a screen-high void under Log activity.
        CSS multi-column balances the heights instead, letting cards stack into
        whichever column has room — no card is pinned to a side any more.
      */}
      <div className="gap-5 sm:columns-2 xl:columns-3 [&>*]:mb-5 [&>*]:break-inside-avoid">
          {writable && <Card title="Log activity">
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
          </Card>}

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

          {writable && (
            <Card title="Move stage">
              <StageChangeForm leadId={lead.id} currentStage={lead.stage_text} />
            </Card>
          )}

          {writable && lead.project_id && <Card title="Check in a visit">
            <form action={checkInVisit} className="space-y-3 p-5">
              <input type="hidden" name="leadId" value={lead.id} />
              <input type="hidden" name="visitId" value={randomUUID()} />
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
          </Card>}
          {writable && !lead.project_id && (
            <Card title="Check in a visit">
              <div className="space-y-2 p-5 text-sm">
                <p className="font-medium">Assign a project before check-in</p>
                <p className="text-muted-foreground">Use the Opportunity project card below so the visit and offline conversion are routed to the correct project.</p>
              </div>
            </Card>
          )}

          {canAssign && <Card title="Ownership">
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
          </Card>}

          {writable && <Card title="Opportunity project" subtitle="Required for unit shortlists and bookings">
            <form action={updateLeadProject} className="space-y-3 p-5">
              <input type="hidden" name="leadId" value={lead.id} />
              <select
                name="projectId"
                defaultValue={lead.project_id ?? ""}
                disabled={Boolean(lead.project_id && lead.has_project_locked_facts)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950"
              >
                <option value="">No project selected</option>
                {activeProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
              {lead.project_id && lead.has_project_locked_facts
                ? <p className="text-xs text-zinc-500">Locked after the first visit or commercial activity to preserve history.</p>
                : <>
                    {!lead.project_id && lead.has_project_locked_facts && (
                      <p className="text-xs text-zinc-500">Choose the project now; unclassified visits and touchpoints will be linked safely.</p>
                    )}
                    <SubmitButton variant="secondary" className="w-full">Save project</SubmitButton>
                  </>}
            </form>
          </Card>}

          <Card title="Qualification" subtitle="Structured feedback trains campaign quality reporting">
            {qualification && (
              <dl className="space-y-2.5 border-b border-zinc-100 px-5 py-4 text-sm dark:border-zinc-800">
                <Row label="Quality"><span className="capitalize">{String(qualification.quality).replace(/_/g, " ")}</span></Row>
                <Row label="Budget">{qualification.budget_min || qualification.budget_max ? `${formatINR(qualification.budget_min, true)} – ${formatINR(qualification.budget_max, true)}` : "—"}</Row>
                <Row label="Configuration">{qualification.desired_configuration ?? "—"}</Row>
                <Row label="Timeline">{qualification.purchase_timeline ?? "—"}</Row>
                <Row label="Funding">{qualification.funding_mode ?? "—"}</Row>
              </dl>
            )}
            {writable ? (
              <form action={saveQualification} className="space-y-3 p-5">
                <input type="hidden" name="leadId" value={lead.id} />
                <label className="block"><span className="mb-1 block text-xs text-zinc-500">Lead quality</span><select name="quality" defaultValue={qualification?.quality ?? "unrated"} className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"><option value="unrated">Unrated</option><option value="invalid">Invalid</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="very_high">Very high</option></select></label>
                <div className="grid grid-cols-2 gap-2"><label className="block"><span className="mb-1 block text-xs text-zinc-500">Budget min</span><input name="budgetMin" inputMode="numeric" defaultValue={qualification?.budget_min ?? ""} placeholder="15000000" className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" /></label><label className="block"><span className="mb-1 block text-xs text-zinc-500">Budget max</span><input name="budgetMax" inputMode="numeric" defaultValue={qualification?.budget_max ?? ""} placeholder="25000000" className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" /></label></div>
                <label className="block"><span className="mb-1 block text-xs text-zinc-500">Configuration</span><input name="desiredConfiguration" defaultValue={qualification?.desired_configuration ?? ""} placeholder="3 BHK, 4 BHK…" className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" /></label>
                <div className="grid grid-cols-2 gap-2"><select name="purchaseIntent" defaultValue={qualification?.purchase_intent ?? ""} className="rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"><option value="">Purchase intent…</option><option value="end_use">End use</option><option value="investment">Investment</option><option value="undecided">Undecided</option></select><select name="purchaseTimeline" defaultValue={qualification?.purchase_timeline ?? ""} className="rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"><option value="">Timeline…</option><option value="immediate">Immediate</option><option value="3_months">Within 3 months</option><option value="6_months">Within 6 months</option><option value="12_months">Within 12 months</option><option value="exploring">Exploring</option></select></div>
                <select name="fundingMode" defaultValue={qualification?.funding_mode ?? ""} className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"><option value="">Funding…</option><option value="self">Self funded</option><option value="home_loan">Home loan</option><option value="mixed">Mixed</option></select>
                <div className="grid grid-cols-2 gap-2 text-xs"><label className="flex items-center gap-2"><input type="checkbox" name="budgetFit" defaultChecked={Boolean(qualification?.budget_fit)} />Budget fit</label><label className="flex items-center gap-2"><input type="checkbox" name="locationFit" defaultChecked={Boolean(qualification?.location_fit)} />Location fit</label><label className="flex items-center gap-2"><input type="checkbox" name="timelineFit" defaultChecked={Boolean(qualification?.timeline_fit)} />Timeline fit</label><label className="flex items-center gap-2"><input type="checkbox" name="configurationFit" defaultChecked={Boolean(qualification?.configuration_fit)} />Configuration fit</label><label className="col-span-2 flex items-center gap-2"><input type="checkbox" name="isDecisionMaker" defaultChecked={Boolean(qualification?.is_decision_maker)} />Decision maker involved</label></div>
                <textarea name="notes" rows={2} defaultValue={qualification?.notes ?? ""} placeholder="Qualification notes…" className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" />
                <SubmitButton className="w-full">Save qualification</SubmitButton>
              </form>
            ) : !qualification ? <EmptyState title="Not qualified yet" /> : null}
          </Card>

          <LeadCommercialPanel orgId={user.orgId} leadId={lead.id} writable={writable} />
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
