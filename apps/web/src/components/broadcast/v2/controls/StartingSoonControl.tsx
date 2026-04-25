"use client";

import { ControlCard } from "../ControlCard";
import { TriggerEnterForm, TriggerOffForm } from "../TriggerButtons";
import type { SimpleControlProps } from "./BrbControl";

export function StartingSoonControl({
  sessionId,
  viewToken,
}: SimpleControlProps) {
  return (
    <ControlCard
      overlayKey="12-starting-soon"
      sessionId={sessionId}
      viewToken={viewToken}
      triggerSlot={
        <div className="flex w-full items-center gap-2">
          <TriggerEnterForm
            overlayKey="12-starting-soon"
            sessionId={sessionId}
            payloadFields={
              <input type="hidden" name="payload" value="{}" />
            }
          />
          <TriggerOffForm
            overlayKey="12-starting-soon"
            sessionId={sessionId}
          />
        </div>
      }
    />
  );
}
