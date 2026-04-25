"use client";

import { ControlCard } from "../ControlCard";
import { ToggleTriggerButton } from "../ToggleTriggerButton";
import type { SimpleControlProps } from "./BrbControl";

export function PenaltiesControl({
  sessionId,
  viewToken,
  active = false,
}: SimpleControlProps) {
  return (
    <ControlCard
      overlayKey="17-penalties"
      sessionId={sessionId}
      viewToken={viewToken}
      triggerSlot={
        <ToggleTriggerButton
          overlayKey="17-penalties"
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
