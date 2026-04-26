"use client";

import { useCallback, useRef } from "react";
import { ControlCard, postToFrame } from "../ControlCard";
import { ToggleTriggerButton } from "../ToggleTriggerButton";
import type { SimpleControlProps } from "./BrbControl";

const LEADERBOARD_PAYLOAD = {
  // Stub satisfies legacy `leaderboard_animated` schema's `rows.min(1)`
  // requirement. The overlay route fetches the real 13-row standings via
  // Realtime once mounted.
  topN: 13,
  rows: [{ rank: 1, displayName: "TBD", pts: 0, gd: 0 }],
};

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
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const onIframeReady = useCallback((el: HTMLIFrameElement | null) => {
    iframeRef.current = el;
  }, []);

  const optimisticToggle = useCallback((nextActive: boolean) => {
    if (nextActive) {
      postToFrame(iframeRef.current, {
        type: "show",
        data: LEADERBOARD_PAYLOAD,
      });
    } else {
      postToFrame(iframeRef.current, { type: "hide" });
    }
  }, []);

  return (
    <ControlCard
      overlayKey="07-leaderboard"
      sessionId={sessionId}
      viewToken={viewToken}
      onIframeReady={onIframeReady}
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
          onOptimisticToggle={optimisticToggle}
          payloadFields={
            <input
              type="hidden"
              name="payload"
              value={JSON.stringify(LEADERBOARD_PAYLOAD)}
            />
          }
        />
      }
    />
  );
}
