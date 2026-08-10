"use client";

import { useActionState, useEffect, useState } from "react";
import { AlertCircle, Building2, CalendarClock, Loader2, MapPin, Wallet } from "lucide-react";
import {
  checkInFromBoard,
  getStageAdvanceContext,
  recordBookingFromBoard,
  scheduleVisitFromBoard,
  setProjectFromBoard,
  type StageAdvanceContext,
  type StageAdvanceState,
} from "@/lib/stage-advance-actions";
import { stageLabel } from "@/lib/format";
import { FOLLOW_UP_CHANNELS, FOLLOW_UP_CHANNEL_LABELS } from "@/lib/follow-ups";

const field =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-700 dark:bg-zinc-950";
const initialState: StageAdvanceState = { ok: false };

/** Local datetime string for a `datetime-local` default. */
function localInput(offsetHours: number): string {
  const at = new Date(Date.now() + offsetHours * 3_600_000);
  at.setMinutes(0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

const STAGE_COPY: Record<string, { icon: typeof MapPin; title: string; blurb: string }> = {
  visit_scheduled: {
    icon: CalendarClock,
    title: "Schedule the visit",
    blurb:
      "The appointment is what moves this lead — booking one here records it properly instead of just relabelling the card.",
  },
  visited: {
    icon: MapPin,
    title: "Record the arrival",
    blurb:
      "Someone physically turning up is the strongest offline signal this business has, so it needs a real check-in rather than a stage edit.",
  },
  token_paid: {
    icon: Wallet,
    title: "Record the token payment",
    blurb: "Money creates a booking. That booking is what makes this stage true.",
  },
  booked: {
    icon: Wallet,
    title: "Confirm the booking",
    blurb: "A confirmed booking needs the unit and the agreement value on record.",
  },
};

export function StageWorkflowDialog({
  leadId,
  leadName,
  toStage,
  onCancel,
  onDone,
}: {
  leadId: string;
  leadName: string;
  toStage: string;
  onCancel: () => void;
  onDone: (message: string) => void;
}) {
  const [context, setContext] = useState<StageAdvanceContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getStageAdvanceContext(leadId)
      .then((result) => {
        if (!live) return;
        if (result) setContext(result);
        else setLoadError("This lead is no longer available to you.");
      })
      .catch(() => live && setLoadError("Could not load the details for this lead."));
    return () => {
      live = false;
    };
  }, [leadId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const copy = STAGE_COPY[toStage];
  const Icon = copy?.icon ?? Building2;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="stage-workflow-title"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-600/15">
            <Icon aria-hidden className="size-4" />
          </span>
          <div>
            <h2 id="stage-workflow-title" className="text-sm font-semibold">
              {copy?.title ?? `Move to ${stageLabel(toStage)}`}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              {leadName} · {copy?.blurb}
            </p>
          </div>
        </div>

        {loadError ? (
          <p className="mt-4 flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
            {loadError}
          </p>
        ) : !context ? (
          <p className="mt-6 flex items-center justify-center gap-2 py-6 text-sm text-zinc-500">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Loading…
          </p>
        ) : (
          <WorkflowForm
            context={context}
            toStage={toStage}
            onCancel={onCancel}
            onDone={onDone}
            onProjectSet={() => {
              // Re-fetch so the unit list for the newly chosen project appears.
              setContext(null);
              getStageAdvanceContext(leadId).then((result) => result && setContext(result));
            }}
          />
        )}
      </div>
    </div>
  );
}

function WorkflowForm({
  context,
  toStage,
  onCancel,
  onDone,
  onProjectSet,
}: {
  context: StageAdvanceContext;
  toStage: string;
  onCancel: () => void;
  onDone: (message: string) => void;
  onProjectSet: () => void;
}) {
  const needsProject = !context.projectId;
  const isBooking = toStage === "token_paid" || toStage === "booked";

  // A booking needs a unit, and units belong to a project. Asking for both in
  // one step would mean listing units for a project that is not chosen yet.
  if (isBooking && needsProject) {
    return (
      <ProjectFirst context={context} onCancel={onCancel} onProjectSet={onProjectSet} />
    );
  }

  if (isBooking) {
    return (
      <BookingForm context={context} toStage={toStage} onCancel={onCancel} />
    );
  }

  return (
    <VisitForm
      context={context}
      toStage={toStage}
      needsProject={needsProject}
      onCancel={onCancel}
      onDone={onDone}
    />
  );
}

function ProjectSelect({ context }: { context: StageAdvanceContext }) {
  return (
    <label className="mt-4 block">
      <span className="mb-1 block text-xs font-medium text-zinc-500">Project *</span>
      <select name="projectId" required defaultValue="" className={field}>
        <option value="" disabled>
          Choose the project…
        </option>
        {context.projects.map((project) => (
          <option key={project.id} value={project.id}>{project.name}</option>
        ))}
      </select>
      <span className="mt-1 block text-xs text-zinc-500">
        This lead has no project yet, and neither a visit nor a booking can be filed without one.
      </span>
    </label>
  );
}

function Footer({
  pending,
  label,
  onCancel,
}: {
  pending: boolean;
  label: string;
  onCancel: () => void;
}) {
  return (
    <div className="mt-5 flex justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
      >
        {pending ? "Saving…" : label}
      </button>
    </div>
  );
}

/**
 * Asked by every workflow, so a lead that advances through a visit or a booking
 * lands on the follow-ups page the same way one advanced by dragging does.
 */
function NextFollowUp({ context, offsetHours = 24 }: { context: string; offsetHours?: number }) {
  return (
    <div className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <input type="hidden" name="followUpContext" value={context} />
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Next follow-up</p>
      <p className="mt-1 text-xs text-zinc-500">
        Clear it to skip, but a lead with no next step is the one that goes quiet.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-500">When</span>
          <input type="datetime-local" name="followUpAt" defaultValue={localInput(offsetHours)} className={field} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-500">How</span>
          <select name="followUpChannel" defaultValue="call" className={field}>
            {FOLLOW_UP_CHANNELS.map((option) => (
              <option key={option} value={option}>{FOLLOW_UP_CHANNEL_LABELS[option]}</option>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-zinc-500">What did they commit to?</span>
          <input name="followUpCommitment" maxLength={300} placeholder="Will confirm after speaking to spouse" className={field} />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-zinc-500">Notes for the follow-up</span>
          <input name="followUpNote" maxLength={2000} placeholder="What to bring, what to confirm" className={field} />
        </label>
      </div>
    </div>
  );
}

function Failure({ state }: { state: StageAdvanceState }) {
  if (state.ok || !state.message) return null;
  return (
    <p className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
      <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      {state.message}
    </p>
  );
}

function ProjectFirst({
  context,
  onCancel,
  onProjectSet,
}: {
  context: StageAdvanceContext;
  onCancel: () => void;
  onProjectSet: () => void;
}) {
  const [state, action, pending] = useActionState(setProjectFromBoard, initialState);
  useEffect(() => {
    if (state.ok) onProjectSet();
  }, [state.ok, onProjectSet]);

  return (
    <form action={action}>
      <input type="hidden" name="leadId" value={context.leadId} />
      <ProjectSelect context={context} />
      <Failure state={state} />
      <Footer pending={pending} label="Set project" onCancel={onCancel} />
    </form>
  );
}

function VisitForm({
  context,
  toStage,
  needsProject,
  onCancel,
  onDone,
}: {
  context: StageAdvanceContext;
  toStage: string;
  needsProject: boolean;
  onCancel: () => void;
  onDone: (message: string) => void;
}) {
  const scheduling = toStage === "visit_scheduled";
  const [state, action, pending] = useActionState(
    scheduling ? scheduleVisitFromBoard : checkInFromBoard,
    initialState,
  );
  const [visitId] = useState(() =>
    typeof window === "undefined" ? "" : window.crypto.randomUUID(),
  );

  useEffect(() => {
    if (state.ok) onDone(state.message ?? "Done");
  }, [state.ok, state.message, onDone]);

  return (
    <form action={action}>
      <input type="hidden" name="leadId" value={context.leadId} />
      {!scheduling && <input type="hidden" name="visitId" value={visitId} />}
      {!scheduling && <input type="hidden" name="checkInMethod" value="manual" />}
      {needsProject && <ProjectSelect context={context} />}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-500">Location</span>
          <select name={scheduling ? "type" : "visitType"} defaultValue="project_site" className={field}>
            <option value="project_site">Project site</option>
            <option value="corporate_office">Corporate office</option>
            <option value="experience_centre">Experience centre</option>
            {scheduling && <option value="virtual">Virtual tour</option>}
          </select>
        </label>

        {scheduling ? (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500">Date &amp; time *</span>
            <input
              type="datetime-local"
              name="scheduledAt"
              required
              defaultValue={localInput(24)}
              className={field}
            />
          </label>
        ) : (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500">People with them</span>
            <input type="number" name="accompanyingCount" min={0} max={20} defaultValue={0} className={field} />
          </label>
        )}

        {scheduling ? (
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-zinc-500">Host</span>
            <select name="hostUserId" defaultValue={context.ownerUserId ?? ""} className={field}>
              <option value="">Unassigned</option>
              {context.agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} · {agent.role.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-500">Intent</span>
              <select name="intentRating" defaultValue="" className={field}>
                <option value="">Unrated</option>
                <option value="5">Very high</option>
                <option value="4">High</option>
                <option value="3">Medium</option>
                <option value="2">Low</option>
                <option value="1">Just looking</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-500">Configurations shown</span>
              <input name="configurationsViewed" placeholder="3 BHK, 4 BHK" className={field} />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-zinc-500">Next action</span>
              <input name="nextAction" placeholder="Proposal, family visit, follow-up call" className={field} />
            </label>
          </>
        )}

        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-zinc-500">Notes</span>
          <textarea name="notes" rows={2} maxLength={2000} placeholder="What was discussed, who came, what to prepare…" className={field} />
        </label>
      </div>

      <NextFollowUp context={scheduling ? "after scheduling the visit" : "after the check-in"} />

      <Failure state={state} />
      <Footer pending={pending} label={scheduling ? "Schedule visit" : "Check in"} onCancel={onCancel} />
    </form>
  );
}

/**
 * Submits straight to the real booking action, which redirects to the new
 * booking. That navigation is the point — somebody who just took money should
 * land on the record of it, not back on a kanban column.
 */
function BookingForm({
  context,
  toStage,
  onCancel,
}: {
  context: StageAdvanceContext;
  toStage: string;
  onCancel: () => void;
}) {
  const confirming = toStage === "booked";
  const [state, action, pending] = useActionState(recordBookingFromBoard, initialState);

  if (context.units.length === 0) {
    return (
      <div>
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          No available units in {context.projectName ?? "this project"}. Add or free up inventory
          before booking.
        </p>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="leadId" value={context.leadId} />
      <input type="hidden" name="initialStatus" value={confirming ? "booked" : "token"} />

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-zinc-500">Unit *</span>
          <select name="unitId" required defaultValue="" className={field}>
            <option value="" disabled>Choose the unit…</option>
            {context.units.map((unit) => (
              <option key={unit.id} value={unit.id}>{unit.label}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-500">Token amount (INR) *</span>
          <input type="number" name="tokenAmount" min="0.01" step="0.01" required className={field} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-500">Payment mode *</span>
          <select name="paymentMode" required defaultValue="upi" className={field}>
            <option value="upi">UPI</option>
            <option value="neft">NEFT</option>
            <option value="cheque">Cheque</option>
            <option value="card">Card</option>
            <option value="cash">Cash</option>
            <option value="other">Other</option>
          </select>
        </label>

        {confirming && (
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-zinc-500">Agreement value (INR) *</span>
            <input type="number" name="agreementValue" min="0.01" step="0.01" required className={field} />
          </label>
        )}

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-500">Reference</span>
          <input name="paymentReference" maxLength={160} placeholder="UTR, cheque no." className={field} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-500">Received at</span>
          <input type="datetime-local" name="receivedAt" defaultValue={localInput(0)} className={field} />
        </label>
      </div>

      <NextFollowUp context={confirming ? "after confirming the booking" : "after the token payment"} offsetHours={48} />

      <p className="mt-3 text-xs text-zinc-500">
        This creates the booking and takes you to it. The unit and the stage follow from that record.
      </p>

      <Failure state={state} />
      <Footer pending={pending} label={confirming ? "Confirm booking" : "Record token"} onCancel={onCancel} />
    </form>
  );
}
