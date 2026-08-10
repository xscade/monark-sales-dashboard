"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { GripVertical } from "lucide-react";
import { toast } from "sonner";
import { checkTransition, type LeadStage } from "@monark/core/pipeline";
import { AttributionClock } from "@/components/ui";
import { moveLeadStage } from "@/lib/actions";
import { formatRelative, maskPhoneDisplay, stageLabel } from "@/lib/format";
import { WORKFLOW_STAGE_HINT, isEditableStage } from "@/lib/stage-edit";

export interface PipelineCard {
  id: string;
  stage: string;
  name: string;
  primaryPhone: string | null;
  ownerName: string | null;
  attributionExpiresAt: string | null;
  nextFollowUpAt: string | null;
}

/** Pointer travel that turns a mouse press into a drag rather than a click. */
const MOUSE_SLOP = 5;
/** How long a finger must rest on a card before it lifts. Below this, the
 *  gesture belongs to the scroller — a sales agent flicking through a column
 *  must not accidentally reassign a lead. */
const LONG_PRESS_MS = 260;
/** Finger travel during the long press that means "I was scrolling". */
const TOUCH_SLOP = 10;
const AUTOSCROLL_EDGE = 72;

interface PendingGesture {
  card: PipelineCard;
  pointerId: number;
  startX: number;
  startY: number;
  left: number;
  top: number;
  width: number;
  timer: number | null;
}

interface DragState {
  card: PipelineCard;
  pointerId: number;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  over: string | null;
}

type TargetState = "idle" | "ok" | "blocked";

function targetState(stage: string, card: PipelineCard | null): TargetState {
  if (!card || stage === card.stage) return "idle";
  if (!isEditableStage(stage)) return "blocked";
  return checkTransition(card.stage as LeadStage, stage as LeadStage).allowed ? "ok" : "blocked";
}

export function PipelineBoard({
  stages,
  cards,
  canWrite,
}: {
  stages: readonly string[];
  cards: PipelineCard[];
  canWrite: boolean;
}) {
  const [optimisticCards, applyMove] = useOptimistic<PipelineCard[], { id: string; toStage: string }>(
    cards,
    (current, move) => current.map((c) => (c.id === move.id ? { ...c, stage: move.toStage } : c)),
  );
  const [isPending, startTransition] = useTransition();
  const [movingId, setMovingId] = useState<string | null>(null);
  const [drag, setDragState] = useState<DragState | null>(null);
  const [keyboardMove, setKeyboardMove] = useState<{ card: PipelineCard; target: string } | null>(null);
  const [reasonPrompt, setReasonPrompt] = useState<{ card: PipelineCard; toStage: string } | null>(null);
  const [mounted, setMounted] = useState(false);

  const boardRef = useRef<HTMLDivElement | null>(null);
  const columnRefs = useRef(new Map<string, HTMLElement>());
  const pendingRef = useRef<PendingGesture | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const autoScrollRef = useRef(0);
  // A drag that ends inside the card would otherwise fire a click on the link
  // underneath and navigate away from the board.
  const suppressClickRef = useRef(false);

  useEffect(() => setMounted(true), []);

  const columns = useMemo(() => {
    const grouped = new Map<string, PipelineCard[]>(stages.map((stage) => [stage, []]));
    for (const card of optimisticCards) grouped.get(card.stage)?.push(card);
    return grouped;
  }, [stages, optimisticCards]);

  /** Stages reachable with the keyboard, in board order. */
  const keyboardTargets = useMemo<string[]>(() => stages.filter(isEditableStage), [stages]);

  const setDrag = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDragState(next);
  }, []);

  const commitMove = useCallback(
    (card: PipelineCard, toStage: string, reason: string | null) => {
      setMovingId(card.id);
      startTransition(async () => {
        applyMove({ id: card.id, toStage });
        const result = await moveLeadStage({
          leadId: card.id,
          toStage,
          reason: reason ?? undefined,
        });
        setMovingId(null);
        if (result.ok) toast.success(`${card.name} moved to ${stageLabel(toStage)}`);
        else toast.error(result.message ?? "Could not move the lead");
      });
    },
    [applyMove],
  );

  /**
   * Every route into a stage change goes through here — drop, keyboard, dialog.
   * A drag records the move but not the "why", so a backwards move stops and
   * asks for one instead of silently discarding it: regressions are exactly
   * what funnel analysis needs an explanation for.
   */
  const attemptMove = useCallback(
    (card: PipelineCard, toStage: string) => {
      if (toStage === card.stage) return;
      if (!isEditableStage(toStage)) {
        toast.error(
          WORKFLOW_STAGE_HINT[toStage as LeadStage] ?? "That stage is set by its own workflow",
        );
        return;
      }
      const check = checkTransition(card.stage as LeadStage, toStage as LeadStage);
      if (!check.allowed) {
        toast.error(check.reason ?? "That move is not allowed");
        return;
      }
      if (check.requiresReason) {
        setReasonPrompt({ card, toStage });
        return;
      }
      commitMove(card, toStage, null);
    },
    [commitMove],
  );

  const stageAtPoint = useCallback((x: number, y: number): string | null => {
    for (const [stage, el] of columnRefs.current) {
      const rect = el.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return stage;
    }
    return null;
  }, []);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRef.current) cancelAnimationFrame(autoScrollRef.current);
    autoScrollRef.current = 0;
  }, []);

  /** Eight columns do not fit on one screen; without this, the far end of the
   *  funnel is unreachable while holding a card. */
  const autoScroll = useCallback(() => {
    const board = boardRef.current;
    const active = dragRef.current;
    if (!board || !active) {
      autoScrollRef.current = 0;
      return;
    }
    const rect = board.getBoundingClientRect();
    const { x, y } = pointerRef.current;
    let delta = 0;
    if (x < rect.left + AUTOSCROLL_EDGE) delta = -Math.ceil((rect.left + AUTOSCROLL_EDGE - x) / 4);
    else if (x > rect.right - AUTOSCROLL_EDGE) delta = Math.ceil((x - (rect.right - AUTOSCROLL_EDGE)) / 4);

    if (delta) {
      board.scrollLeft += delta;
      // The columns moved under a stationary finger, so the hovered one may have
      // changed without a pointermove to tell us.
      const over = stageAtPoint(x, y);
      if (over !== active.over) setDrag({ ...active, over });
    }
    autoScrollRef.current = requestAnimationFrame(autoScroll);
  }, [setDrag, stageAtPoint]);

  const cancelPending = useCallback(() => {
    if (pendingRef.current?.timer) window.clearTimeout(pendingRef.current.timer);
    pendingRef.current = null;
  }, []);

  const startDrag = useCallback(
    (x: number, y: number) => {
      const pending = pendingRef.current;
      if (!pending) return;
      if (pending.timer) window.clearTimeout(pending.timer);
      pendingRef.current = null;
      suppressClickRef.current = true;
      pointerRef.current = { x, y };
      setDrag({
        card: pending.card,
        pointerId: pending.pointerId,
        x,
        y,
        offsetX: pending.startX - pending.left,
        offsetY: pending.startY - pending.top,
        width: pending.width,
        over: pending.card.stage,
      });
      setKeyboardMove(null);
      if (!autoScrollRef.current) autoScrollRef.current = requestAnimationFrame(autoScroll);
    },
    [autoScroll, setDrag],
  );

  const endDrag = useCallback(
    (x: number, y: number, commit: boolean) => {
      const active = dragRef.current;
      setDrag(null);
      stopAutoScroll();
      if (!active || !commit) return;
      const target = stageAtPoint(x, y);
      if (target) attemptMove(active.card, target);
    },
    [attemptMove, setDrag, stageAtPoint, stopAutoScroll],
  );

  useEffect(() => {
    if (!canWrite) return;

    const onPointerMove = (event: PointerEvent) => {
      const active = dragRef.current;
      if (active) {
        if (event.pointerId !== active.pointerId) return;
        pointerRef.current = { x: event.clientX, y: event.clientY };
        setDrag({
          ...active,
          x: event.clientX,
          y: event.clientY,
          over: stageAtPoint(event.clientX, event.clientY),
        });
        return;
      }

      const pending = pendingRef.current;
      if (!pending || event.pointerId !== pending.pointerId) return;
      const distance = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
      if (event.pointerType === "touch") {
        if (distance > TOUCH_SLOP) cancelPending();
        return;
      }
      if (distance > MOUSE_SLOP) startDrag(event.clientX, event.clientY);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (dragRef.current) {
        if (event.pointerId !== dragRef.current.pointerId) return;
        endDrag(event.clientX, event.clientY, true);
        return;
      }
      cancelPending();
    };

    const onPointerCancel = () => {
      cancelPending();
      endDrag(0, 0, false);
    };

    // React listens for touchmove passively, so the page would keep scrolling
    // under a lifted card. This is the only way to hold it still.
    const onTouchMove = (event: TouchEvent) => {
      if (dragRef.current) event.preventDefault();
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      document.removeEventListener("touchmove", onTouchMove);
    };
  }, [canWrite, cancelPending, endDrag, setDrag, stageAtPoint, startDrag]);

  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  useEffect(() => {
    if (!drag) return;
    const previous = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.userSelect = previous;
    };
  }, [drag]);

  const beginGesture = (
    event: React.PointerEvent,
    card: PipelineCard,
    { immediate }: { immediate: boolean },
  ) => {
    if (!canWrite || dragRef.current || pendingRef.current) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const element = (event.currentTarget as HTMLElement).closest<HTMLElement>("[data-pipeline-card]");
    if (!element) return;

    suppressClickRef.current = false;
    const rect = element.getBoundingClientRect();
    const pending: PendingGesture = {
      card,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      timer: null,
    };
    pendingRef.current = pending;

    if (immediate) {
      startDrag(event.clientX, event.clientY);
      return;
    }
    if (event.pointerType === "touch") {
      pending.timer = window.setTimeout(() => startDrag(pending.startX, pending.startY), LONG_PRESS_MS);
    }
  };

  const onCardClick = (event: React.MouseEvent) => {
    if (!suppressClickRef.current) return;
    event.preventDefault();
    suppressClickRef.current = false;
  };

  const onHandleKeyDown = (event: React.KeyboardEvent, card: PipelineCard) => {
    if (!canWrite || keyboardTargets.length === 0) return;
    const active = keyboardMove?.card.id === card.id ? keyboardMove : null;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!active) {
        const start = keyboardTargets.indexOf(card.stage);
        setKeyboardMove({ card, target: keyboardTargets[start === -1 ? 0 : start] });
        return;
      }
      setKeyboardMove(null);
      attemptMove(card, active.target);
      return;
    }
    if (!active) return;

    if (event.key === "Escape") {
      event.preventDefault();
      setKeyboardMove(null);
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      const current = keyboardTargets.indexOf(active.target);
      const next = Math.min(Math.max(current + step, 0), keyboardTargets.length - 1);
      setKeyboardMove({ card, target: keyboardTargets[next] });
    }
  };

  const heldCard = drag?.card ?? keyboardMove?.card ?? null;

  return (
    <>
      <div ref={boardRef} className="flex gap-3 overflow-x-auto pb-4">
        {stages.map((stage) => {
          const column = columns.get(stage) ?? [];
          const state = targetState(stage, heldCard);
          const isOver = drag?.over === stage || keyboardMove?.target === stage;

          return (
            <div
              key={stage}
              ref={(el) => {
                if (el) columnRefs.current.set(stage, el);
                else columnRefs.current.delete(stage);
              }}
              className={`w-72 shrink-0 rounded-xl transition ${
                isOver && state === "ok"
                  ? "bg-brand-50/70 ring-2 ring-brand-500 dark:bg-brand-600/10"
                  : isOver && state === "blocked"
                    ? "bg-red-50/60 ring-2 ring-red-400 dark:bg-red-950/30"
                    : heldCard && state === "blocked"
                      ? "opacity-45"
                      : ""
              }`}
            >
              <div className="mb-2 flex items-center justify-between px-1 pt-1">
                <h2 className="text-sm font-medium">{stageLabel(stage)}</h2>
                <span className="tabular rounded-md bg-zinc-200 px-1.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                  {column.length}
                </span>
              </div>

              <div className="min-h-52 space-y-2 px-1 pb-1">
                {column.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-6 text-center text-xs text-zinc-400 dark:border-zinc-800">
                    {isOver && state === "ok" ? "Drop here" : "Empty"}
                  </p>
                ) : (
                  column.slice(0, 50).map((card) => (
                    <div
                      key={card.id}
                      data-pipeline-card
                      className={`group relative transition ${
                        drag?.card.id === card.id ? "opacity-35" : ""
                      } ${movingId === card.id && isPending ? "opacity-60" : ""}`}
                      onPointerDown={(event) => beginGesture(event, card, { immediate: false })}
                    >
                      <Link
                        href={`/leads/${card.id}`}
                        onClick={onCardClick}
                        className={`block rounded-lg border border-zinc-200 bg-white p-3 transition hover:border-brand-500 dark:border-zinc-800 dark:bg-zinc-900 ${
                          canWrite ? "cursor-grab select-none active:cursor-grabbing" : ""
                        }`}
                      >
                        <p className="truncate pr-6 text-sm font-medium">{card.name}</p>
                        <p className="tabular mt-0.5 truncate text-xs text-zinc-500">
                          {maskPhoneDisplay(card.primaryPhone)}
                        </p>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-zinc-500">
                            {card.ownerName ?? "Unassigned"}
                          </span>
                          <AttributionClock expiresAt={card.attributionExpiresAt} />
                        </div>
                        {card.nextFollowUpAt && (
                          <p
                            className={`mt-1.5 text-xs ${
                              new Date(card.nextFollowUpAt) < new Date()
                                ? "text-red-600 dark:text-red-400"
                                : "text-zinc-500"
                            }`}
                          >
                            Follow up {formatRelative(card.nextFollowUpAt)}
                          </p>
                        )}
                      </Link>

                      {canWrite && (
                        <button
                          type="button"
                          aria-label={`Move ${card.name} to another stage`}
                          title="Drag, or press Enter then use the arrow keys"
                          style={{ touchAction: "none" }}
                          onPointerDown={(event) => beginGesture(event, card, { immediate: true })}
                          onKeyDown={(event) => onHandleKeyDown(event, card)}
                          onBlur={() => setKeyboardMove(null)}
                          className={`absolute right-1 top-1 rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:hover:bg-zinc-800 ${
                            keyboardMove?.card.id === card.id
                              ? "opacity-100"
                              : "opacity-60 sm:opacity-0 sm:group-hover:opacity-100"
                          }`}
                        >
                          <GripVertical className="size-4" />
                        </button>
                      )}
                    </div>
                  ))
                )}

                {column.length > 50 && (
                  <p className="px-1 text-xs text-zinc-400">+{column.length - 50} more</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {keyboardMove && (
        <div
          aria-live="polite"
          className="fixed inset-x-0 bottom-4 z-50 mx-auto w-fit rounded-full bg-zinc-900 px-4 py-2 text-xs text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
        >
          Moving {keyboardMove.card.name} to <b>{stageLabel(keyboardMove.target)}</b> · ← → to
          choose, Enter to confirm, Esc to cancel
        </div>
      )}

      {mounted &&
        drag &&
        createPortal(
          <div
            className="pointer-events-none fixed left-0 top-0 z-[60] rounded-lg border border-brand-500 bg-white p-3 shadow-xl dark:bg-zinc-900"
            style={{
              width: drag.width,
              transform: `translate3d(${drag.x - drag.offsetX}px, ${drag.y - drag.offsetY}px, 0) rotate(1.5deg)`,
            }}
          >
            <p className="truncate text-sm font-medium">{drag.card.name}</p>
            <p className="tabular mt-0.5 truncate text-xs text-zinc-500">
              {maskPhoneDisplay(drag.card.primaryPhone)}
            </p>
            <p className="mt-2 truncate text-xs text-zinc-500">
              {drag.over && drag.over !== drag.card.stage
                ? `→ ${stageLabel(drag.over)}`
                : stageLabel(drag.card.stage)}
            </p>
          </div>,
          document.body,
        )}

      {reasonPrompt && (
        <ReasonDialog
          card={reasonPrompt.card}
          toStage={reasonPrompt.toStage}
          onCancel={() => setReasonPrompt(null)}
          onConfirm={(reason) => {
            setReasonPrompt(null);
            commitMove(reasonPrompt.card, reasonPrompt.toStage, reason);
          }}
        />
      )}
    </>
  );
}

/**
 * A backwards move is allowed but never silent.
 *
 * Frequent regressions are either a process problem or stage misuse, and the
 * difference is only readable from the reason attached at the time.
 */
function ReasonDialog({
  card,
  toStage,
  onCancel,
  onConfirm,
}: {
  card: PipelineCard;
  toStage: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="stage-reason-title"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = reason.trim();
          if (trimmed) onConfirm(trimmed);
        }}
        className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 id="stage-reason-title" className="text-sm font-semibold">
          Moving {card.name} back to {stageLabel(toStage)}
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Backwards moves need a reason — it is what makes the regression readable in the funnel
          later.
        </p>
        <input
          ref={inputRef}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={500}
          placeholder="Why is this lead moving back?"
          className="mt-3 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!reason.trim()}
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            Move lead
          </button>
        </div>
      </form>
    </div>
  );
}
