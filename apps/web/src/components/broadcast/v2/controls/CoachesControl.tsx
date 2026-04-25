"use client";

import { ControlCard } from "../ControlCard";
import { ToggleTriggerButton } from "../ToggleTriggerButton";
import type { SimpleControlProps } from "./BrbControl";

export function CoachesControl({
  sessionId,
  viewToken,
  active = false,
}: SimpleControlProps) {
  return (
    <ControlCard
      overlayKey="16-coaches"
      sessionId={sessionId}
      viewToken={viewToken}
      triggerSlot={
        <ToggleTriggerButton
          overlayKey="16-coaches"
          sessionId={sessionId}
          active={active}
          payloadFields={
            <input
              type="hidden"
              name="payload"
              value={JSON.stringify({
                // Stub satisfies legacy `coach_intros` schema; the v2
                // overlay route reads live coach data via Realtime.
                coach: { displayName: "TBD" },
                players: [],
              })}
            />
          }
        />
      }
    />
  );
}
