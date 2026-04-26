"use client";

import { useCallback, useRef } from "react";
import { ControlCard, postToFrame } from "../ControlCard";
import { ToggleTriggerButton } from "../ToggleTriggerButton";
import type { SimpleControlProps } from "./BrbControl";

const ORGS_PAYLOAD = {
  // Stub satisfies legacy `orgs_roster` schema; the v2 overlay route
  // reads live org data via Realtime.
  org: { name: "CADE Elite" },
  players: [],
};

export function OrgsControl({
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
      postToFrame(iframeRef.current, { type: "show", data: ORGS_PAYLOAD });
    } else {
      postToFrame(iframeRef.current, { type: "hide" });
    }
  }, []);

  return (
    <ControlCard
      overlayKey="15-orgs"
      sessionId={sessionId}
      viewToken={viewToken}
      onIframeReady={onIframeReady}
      active={active}
      triggerSlot={
        <ToggleTriggerButton
          overlayKey="15-orgs"
          sessionId={sessionId}
          active={active}
          onOptimisticToggle={optimisticToggle}
          payloadFields={
            <input
              type="hidden"
              name="payload"
              value={JSON.stringify(ORGS_PAYLOAD)}
            />
          }
        />
      }
    />
  );
}
