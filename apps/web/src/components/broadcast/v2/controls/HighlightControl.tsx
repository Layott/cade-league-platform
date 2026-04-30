"use client";

import { useCallback, useRef } from "react";
import { ControlCard, postToFrame } from "../ControlCard";
import { ToggleTriggerButton } from "../ToggleTriggerButton";
import type { SimpleControlProps } from "./BrbControl";

/**
 * Broadcast control for `/overlay/v2/20-highlight` — the L-shaped layout
 * with HIGHLIGHT title + logo block on the left, large video stage area
 * upper-right, and a recent-fixtures strip across the bottom.
 *
 * Same payload shape as match-scores-day (week + fixtures) since the
 * server endpoint is shared. No extra control fields needed.
 */
export function HighlightControl({
  sessionId,
  viewToken,
  active = false,
}: SimpleControlProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const onIframeReady = useCallback((el: HTMLIFrameElement | null) => {
    iframeRef.current = el;
  }, []);

  const optimisticToggle = useCallback((nextActive: boolean) => {
    if (nextActive) {
      postToFrame(iframeRef.current, { type: "show", data: {} });
    } else {
      postToFrame(iframeRef.current, { type: "hide" });
    }
  }, []);

  return (
    <ControlCard
      overlayKey="20-highlight"
      sessionId={sessionId}
      viewToken={viewToken}
      onIframeReady={onIframeReady}
      active={active}
      triggerSlot={
        <ToggleTriggerButton
          overlayKey="20-highlight"
          sessionId={sessionId}
          active={active}
          onOptimisticToggle={optimisticToggle}
          payloadFields={
            <input
              type="hidden"
              name="payload"
              value='{"matchDayLabel":"HIGHLIGHT"}'
            />
          }
        />
      }
    />
  );
}
