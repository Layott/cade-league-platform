"use client";

import { ControlCard } from "../ControlCard";
import { TriggerEnterForm, TriggerOffForm } from "../TriggerButtons";
import type { SimpleControlProps } from "./BrbControl";

export function StreamEndedControl({
  sessionId,
  viewToken,
}: SimpleControlProps) {
  return (
    <ControlCard
      overlayKey="13-stream-ended"
      sessionId={sessionId}
      viewToken={viewToken}
      triggerSlot={
        <div className="flex w-full items-center gap-2">
          <TriggerEnterForm
            overlayKey="13-stream-ended"
            sessionId={sessionId}
            payloadFields={
              <input type="hidden" name="payload" value="{}" />
            }
          />
          <TriggerOffForm
            overlayKey="13-stream-ended"
            sessionId={sessionId}
          />
        </div>
      }
    />
  );
}
