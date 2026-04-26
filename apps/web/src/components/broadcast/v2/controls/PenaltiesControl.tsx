"use client";

import { useCallback, useRef } from "react";
import { ControlCard, postToFrame } from "../ControlCard";
import { ToggleTriggerButton } from "../ToggleTriggerButton";
import type { SimpleControlProps } from "./BrbControl";

export function PenaltiesControl({
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
      overlayKey="17-penalties"
      sessionId={sessionId}
      viewToken={viewToken}
      onIframeReady={onIframeReady}
      active={active}
      triggerSlot={
        <ToggleTriggerButton
          overlayKey="17-penalties"
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
