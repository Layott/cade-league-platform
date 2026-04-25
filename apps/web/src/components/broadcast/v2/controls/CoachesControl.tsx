"use client";

import { ControlCard } from "../ControlCard";
import { TriggerEnterForm, TriggerOffForm } from "../TriggerButtons";
import type { SimpleControlProps } from "./BrbControl";

export function CoachesControl({
  sessionId,
  viewToken,
}: SimpleControlProps) {
  return (
    <ControlCard
      overlayKey="16-coaches"
      sessionId={sessionId}
      viewToken={viewToken}
      triggerSlot={
        <div className="flex w-full items-center gap-2">
          <TriggerEnterForm
            overlayKey="16-coaches"
            sessionId={sessionId}
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
          <TriggerOffForm overlayKey="16-coaches" sessionId={sessionId} />
        </div>
      }
    />
  );
}
