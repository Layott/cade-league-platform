"use client";

import { ControlCard } from "../ControlCard";
import { ToggleTriggerButton } from "../ToggleTriggerButton";
import type { SimpleControlProps } from "./BrbControl";

export function StreamEndedControl({
  sessionId,
  viewToken,
  active = false,
}: SimpleControlProps) {
  return (
    <ControlCard
      overlayKey="13-stream-ended"
      sessionId={sessionId}
      viewToken={viewToken}
      triggerSlot={
        <ToggleTriggerButton
          overlayKey="13-stream-ended"
          sessionId={sessionId}
          active={active}
          payloadFields={
            <input type="hidden" name="payload" value="{}" />
          }
        />
      }
    />
  );
}
