"use client";

import { ControlCard } from "../ControlCard";
import { TriggerEnterForm, TriggerOffForm } from "../TriggerButtons";
import type { SimpleControlProps } from "./BrbControl";

/**
 * Plan 51 — animated leaderboard control.
 *
 * No edits — the overlay reads live standings via the existing
 * `public:standings:<seasonId>` realtime channel. ENTER triggers the
 * snapshot capture flow on the overlay route. OUT clears the active row.
 */
export function LeaderboardControl({
  sessionId,
  viewToken,
}: SimpleControlProps) {
  return (
    <ControlCard
      overlayKey="07-leaderboard"
      sessionId={sessionId}
      viewToken={viewToken}
      editPanel={
        <p className="text-[10px] leading-relaxed text-[var(--chalk-3)]">
          Pulls live standings + match-day delta arrows from the active
          season. ENTER triggers the snapshot replay; OUT clears the
          overlay.
        </p>
      }
      triggerSlot={
        <div className="flex w-full items-center gap-2">
          <TriggerEnterForm
            overlayKey="07-leaderboard"
            sessionId={sessionId}
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
          <TriggerOffForm
            overlayKey="07-leaderboard"
            sessionId={sessionId}
          />
        </div>
      }
    />
  );
}
