"use client";

import { ControlCard } from "../ControlCard";
import { TriggerEnterForm, TriggerOffForm } from "../TriggerButtons";

/** Plan 51 — BRB / intermission control. No edits, just ENTER + OUT. */
export type SimpleControlProps = {
  sessionId: string;
  viewToken: string | null;
};

export function BrbControl({ sessionId, viewToken }: SimpleControlProps) {
  return (
    <ControlCard
      overlayKey="01-brb"
      sessionId={sessionId}
      viewToken={viewToken}
      triggerSlot={
        <div className="flex w-full items-center gap-2">
          <TriggerEnterForm
            overlayKey="01-brb"
            sessionId={sessionId}
            payloadFields={
              <input type="hidden" name="payload" value="{}" />
            }
          />
          <TriggerOffForm overlayKey="01-brb" sessionId={sessionId} />
        </div>
      }
    />
  );
}
