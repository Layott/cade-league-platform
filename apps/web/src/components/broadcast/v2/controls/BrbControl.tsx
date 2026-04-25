"use client";

import { ControlCard } from "../ControlCard";
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
  return (
    <ControlCard
      overlayKey="01-brb"
      sessionId={sessionId}
      viewToken={viewToken}
      triggerSlot={
        <ToggleTriggerButton
          overlayKey="01-brb"
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
