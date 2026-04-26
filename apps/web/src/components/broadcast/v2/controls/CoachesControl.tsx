"use client";

import { useCallback, useRef } from "react";
import { ControlCard, postToFrame } from "../ControlCard";
import { ToggleTriggerButton } from "../ToggleTriggerButton";
import type { SimpleControlProps } from "./BrbControl";

const COACHES_PAYLOAD = {
  // Stub satisfies legacy `coach_intros` schema; the v2 overlay route
  // reads live coach data via Realtime.
  coach: { displayName: "TBD" },
  players: [],
};

export function CoachesControl({
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
      postToFrame(iframeRef.current, { type: "show", data: COACHES_PAYLOAD });
    } else {
      postToFrame(iframeRef.current, { type: "hide" });
    }
  }, []);

  return (
    <ControlCard
      overlayKey="16-coaches"
      sessionId={sessionId}
      viewToken={viewToken}
      onIframeReady={onIframeReady}
      triggerSlot={
        <ToggleTriggerButton
          overlayKey="16-coaches"
          sessionId={sessionId}
          active={active}
          onOptimisticToggle={optimisticToggle}
          payloadFields={
            <input
              type="hidden"
              name="payload"
              value={JSON.stringify(COACHES_PAYLOAD)}
            />
          }
        />
      }
    />
  );
}
