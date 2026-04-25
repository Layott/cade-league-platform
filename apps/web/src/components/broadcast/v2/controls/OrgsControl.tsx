"use client";

import { ControlCard } from "../ControlCard";
import { TriggerEnterForm, TriggerOffForm } from "../TriggerButtons";
import type { SimpleControlProps } from "./BrbControl";

export function OrgsControl({ sessionId, viewToken }: SimpleControlProps) {
  return (
    <ControlCard
      overlayKey="15-orgs"
      sessionId={sessionId}
      viewToken={viewToken}
      triggerSlot={
        <div className="flex w-full items-center gap-2">
          <TriggerEnterForm
            overlayKey="15-orgs"
            sessionId={sessionId}
            payloadFields={
              <input
                type="hidden"
                name="payload"
                value={JSON.stringify({
                  // Stub satisfies legacy `orgs_roster` schema; the v2
                  // overlay route reads live org data via Realtime.
                  org: { name: "CADE Elite" },
                  players: [],
                })}
              />
            }
          />
          <TriggerOffForm overlayKey="15-orgs" sessionId={sessionId} />
        </div>
      }
    />
  );
}
