"use client";

import { ControlCard } from "../ControlCard";
import { ToggleTriggerButton } from "../ToggleTriggerButton";
import type { SimpleControlProps } from "./BrbControl";

export function StartingSoonControl({
  sessionId,
  viewToken,
  active = false,
}: SimpleControlProps) {
  return (
    <ControlCard
      overlayKey="12-starting-soon"
      sessionId={sessionId}
      viewToken={viewToken}
      triggerSlot={
        <ToggleTriggerButton
          overlayKey="12-starting-soon"
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
