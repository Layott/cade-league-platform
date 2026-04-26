"use client";

import { useCallback, useRef } from "react";
import { ControlCard, postToFrame } from "../ControlCard";
import { ReTriggerHideButtons } from "../ReTriggerHideButtons";
import type { SimpleControlProps } from "./BrbControl";

/**
 * Plan 51 — Match Scores (today) control.
 *
 * 2026-04-26 redesign per user brief: drop the 3-part split (Part 1/2/3)
 * and render ALL matches of the day on a single page. The 3-part toggle
 * was unreliable (re-clicking Part 1 after Show All did not fire) and
 * operationally confusing — a single full-day grid covers the use-case.
 *
 * The control is now a simple EDITABLE re-trigger:
 *   - "Trigger" clears the active row (if any) and re-fires the
 *     persistent `match_scores_day` payload, replaying the entry
 *     animation. Each click ALWAYS fires fresh — no toggle behaviour.
 *   - "Hide" clears the active row.
 *
 * The actual rows + scores + slugs come from the server-side
 * `/api/broadcast/sessions/<id>/match-scores-day` initial-fetch hook in
 * `OverlayDataInjector`. The persistent payload here is just a label
 * placeholder so the overlay HTML has something to render before the
 * fetch lands. Realtime `score.changed` / `match.ended` events repaint
 * the rows mid-show without re-trigger.
 */

export function MatchScoresDayControl({
  sessionId,
  viewToken,
  active = false,
}: SimpleControlProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const onIframeReady = useCallback((el: HTMLIFrameElement | null) => {
    iframeRef.current = el;
  }, []);

  const optimisticTrigger = useCallback(() => {
    // Optimistic — fire `show` so the overlay's entry animation runs
    // immediately. Server-side initial-fetch repaints rows once the
    // /api/broadcast/sessions/<id>/match-scores-day response lands.
    postToFrame(iframeRef.current, {
      type: "show",
      data: { matchDayLabel: "MATCH DAY", rows: [] },
    });
  }, []);

  const optimisticHide = useCallback(() => {
    postToFrame(iframeRef.current, { type: "hide" });
  }, []);

  return (
    <ControlCard
      overlayKey="11-match-scores-day"
      sessionId={sessionId}
      viewToken={viewToken}
      onIframeReady={onIframeReady}
      liveBadge={active}
      active={active}
      editPanel={
        <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--chalk-3)]">
          All matches for the current match-day render on a single page
          with photos + live scores. Trigger to re-fire entry animation;
          rows refresh in real time as scores update.
        </p>
      }
      triggerSlot={
        <ReTriggerHideButtons
          overlayKey="11-match-scores-day"
          sessionId={sessionId}
          active={active}
          triggerLabel="Trigger"
          onOptimisticTrigger={optimisticTrigger}
          onOptimisticHide={optimisticHide}
          payloadFields={
            <input
              type="hidden"
              name="payload"
              value={JSON.stringify({
                matchDayLabel: "MATCH DAY",
                rows: [],
              })}
            />
          }
        />
      }
    />
  );
}
