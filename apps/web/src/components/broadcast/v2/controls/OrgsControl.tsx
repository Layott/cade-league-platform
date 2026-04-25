"use client";

import { ControlCard } from "../ControlCard";
import { ToggleTriggerButton } from "../ToggleTriggerButton";
import type { SimpleControlProps } from "./BrbControl";

export function OrgsControl({
  sessionId,
  viewToken,
  active = false,
}: SimpleControlProps) {
  return (
    <ControlCard
      overlayKey="15-orgs"
      sessionId={sessionId}
      viewToken={viewToken}
      triggerSlot={
        <ToggleTriggerButton
          overlayKey="15-orgs"
          sessionId={sessionId}
          active={active}
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
      }
    />
  );
}
