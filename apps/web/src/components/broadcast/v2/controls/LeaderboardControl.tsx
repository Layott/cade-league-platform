"use client";

import { ControlCard } from "../ControlCard";
import { ToggleTriggerButton } from "../ToggleTriggerButton";
import type { SimpleControlProps } from "./BrbControl";

/**
 * Plan 51 — animated leaderboard control.
 *
 * No edits — the overlay reads live standings via the existing
 * `public:standings:<seasonId>` realtime channel. Toggle button drives
 * snapshot capture / clear.
 */
export function LeaderboardControl({
  sessionId,
  viewToken,
  active = false,
}: SimpleControlProps) {
  return (
    <ControlCard
      overlayKey="07-leaderboard"
      sessionId={sessionId}
      viewToken={viewToken}
      editPanel={
        <p className="text-[10px] leading-relaxed text-[var(--chalk-3)]">
          Pulls live standings + match-day delta arrows from the active
          season. Toggle the switch to play / clear the snapshot.
        </p>
      }
      triggerSlot={
        <ToggleTriggerButton
          overlayKey="07-leaderboard"
          sessionId={sessionId}
          active={active}
          payloadFields={
            <input
              type="hidden"
              name="payload"
              value={JSON.stringify({
                // Stub satisfies legacy `leaderboard_animated` schema's
                // `rows.min(1)` requirement. The overlay route fetches
                // the real 13-row standings via Realtime once mounted.
                topN: 13,
                rows: [
                  { rank: 1, displayName: "TBD", pts: 0, gd: 0 },
                ],
              })}
            />
          }
        />
      }
    />
  );
}
