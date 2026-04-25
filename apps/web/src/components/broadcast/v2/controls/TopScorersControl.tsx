"use client";

import { ControlCard } from "../ControlCard";
import { TriggerEnterForm, TriggerOffForm } from "../TriggerButtons";
import type { SimpleControlProps } from "./BrbControl";

export function TopScorersControl({
  sessionId,
  viewToken,
}: SimpleControlProps) {
  return (
    <ControlCard
      overlayKey="14-top-scorers"
      sessionId={sessionId}
      viewToken={viewToken}
      triggerSlot={
        <div className="flex w-full items-center gap-2">
          <TriggerEnterForm
            overlayKey="14-top-scorers"
            sessionId={sessionId}
            payloadFields={
              <input type="hidden" name="payload" value="{}" />
            }
          />
          <TriggerOffForm
            overlayKey="14-top-scorers"
            sessionId={sessionId}
          />
        </div>
      }
    />
  );
}
