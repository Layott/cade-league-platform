"use client";

import { useCallback, useRef } from "react";
import { ControlCard, postToFrame } from "../ControlCard";
import { ToggleTriggerButton } from "../ToggleTriggerButton";
import type { SimpleControlProps } from "./BrbControl";

const LEADERBOARD_PAYLOAD = {
  // Schema accepts empty rows — overlay route fetches the real 13-row
  // standings via Realtime + initial fetch once mounted. Posting an
  // empty rows array means "trigger visibility, don't override data".
  topN: 13,
  rows: [],
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
      // No data — preserves whatever the iframe already fetched/rendered.
      postToFrame(iframeRef.current, { type: "show" });
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
      active={active}
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
