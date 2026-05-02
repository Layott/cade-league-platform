"use client";

import { useCallback, useRef, useState } from "react";
import { ControlCard, postToFrame } from "../ControlCard";
import { ReTriggerHideButtons } from "../ReTriggerHideButtons";
import type { SimpleControlProps } from "./BrbControl";

/**
 * Broadcast control for `/overlay/v2/19-player-squads`.
 *
 * The overlay shows ONE player's draft at a time. Operator picks the
 * player from a dropdown of 13 Elite competitors; the playerId is sent
 * as a hidden payload field on Trigger so the server `INITIAL_FETCH_PATH`
 * can resolve the right submission via `?playerId=`.
 *
 * Optional `?week=` left unset — server defaults to the current
 * Thursday-anchored week (`weekStartThursday(now)`).
 *
 * EDITABLE control — uses ReTriggerHideButtons (same pattern as h2h-2,
 * timer, score-bug). The "Trigger" button always re-fires the current
 * payload (clear-then-trigger), so swapping the picked player and
 * re-clicking replays the entry animation with the new draft. The
 * "Trigger OFF" button clears the active overlay_events row without
 * re-firing — operators get an unambiguous "remove from stream" affordance
 * separate from the trigger.
 */
export type PlayerOption = {
  playerId: string;
  displayName: string;
  gamerTag: string | null;
};

export function PlayerSquadsControl({
  sessionId,
  viewToken,
  active = false,
  players,
}: SimpleControlProps & { players: PlayerOption[] }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [pinnedPlayerId, setPinnedPlayerId] = useState<string>(
    players[0]?.playerId ?? "",
  );

  const onIframeReady = useCallback((el: HTMLIFrameElement | null) => {
    iframeRef.current = el;
  }, []);

  // Optimistic — postMessage `show` synchronously on Trigger click so the
  // operator sees the entry animation before the server round-trip lands.
  const optimisticTrigger = useCallback(() => {
    postToFrame(iframeRef.current, {
      type: "show",
      data: { playerId: pinnedPlayerId },
    });
  }, [pinnedPlayerId]);

  const optimisticHide = useCallback(() => {
    postToFrame(iframeRef.current, { type: "hide" });
  }, []);

  return (
    <ControlCard
      overlayKey="19-player-squads"
      sessionId={sessionId}
      viewToken={viewToken}
      onIframeReady={onIframeReady}
      liveBadge={active}
      editPanel={
        <div className="flex flex-col gap-2">
          <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]">
            Show draft for
          </label>
          <select
            value={pinnedPlayerId}
            onChange={(e) => setPinnedPlayerId(e.target.value)}
            className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1 text-sm text-[var(--chalk-1)]"
            data-testid="player-squads-control-picker"
          >
            {players.length === 0 ? (
              <option value="">— no players —</option>
            ) : (
              players.map((p) => (
                <option key={p.playerId} value={p.playerId}>
                  {p.displayName}
                </option>
              ))
            )}
          </select>
        </div>
      }
      triggerSlot={
        <ReTriggerHideButtons
          overlayKey="19-player-squads"
          sessionId={sessionId}
          active={active}
          canTrigger={!!pinnedPlayerId}
          hideLabel="Trigger OFF"
          onOptimisticTrigger={optimisticTrigger}
          onOptimisticHide={optimisticHide}
          payloadFields={
            <input
              type="hidden"
              name="payload"
              value={JSON.stringify({ playerId: pinnedPlayerId })}
            />
          }
        />
      }
    />
  );
}
