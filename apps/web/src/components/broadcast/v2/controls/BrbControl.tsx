"use client";

import { useCallback, useRef } from "react";
import { ControlCard, postToFrame } from "../ControlCard";
import { ToggleTriggerButton } from "../ToggleTriggerButton";

/** Plan 51 — BRB / intermission control. No edits, just a toggle button. */
export type SimpleControlProps = {
  sessionId: string;
  viewToken: string | null;
  /** Whether the overlay is currently active (drives button label/color). */
  active?: boolean;
};

export function BrbControl({
  sessionId,
  viewToken,
  active = false,
}: SimpleControlProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const onIframeReady = useCallback((el: HTMLIFrameElement | null) => {
    iframeRef.current = el;
  }, []);

  // Optimistic — postMessage `show`/`hide` synchronously on click so the
  // preview reacts before the server round-trip lands.
  const optimisticToggle = useCallback((nextActive: boolean) => {
    if (nextActive) {
      postToFrame(iframeRef.current, { type: "show", data: {} });
    } else {
      postToFrame(iframeRef.current, { type: "hide" });
    }
  }, []);

  return (
    <ControlCard
      overlayKey="01-brb"
      sessionId={sessionId}
      viewToken={viewToken}
      onIframeReady={onIframeReady}
      triggerSlot={
        <ToggleTriggerButton
          overlayKey="01-brb"
          sessionId={sessionId}
          active={active}
          onOptimisticToggle={optimisticToggle}
          payloadFields={
            <input type="hidden" name="payload" value="{}" />
          }
        />
      }
    />
  );
}
