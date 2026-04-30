"use client";

import { useCallback, useRef, useState } from "react";
import { ControlCard, postToFrame } from "../ControlCard";
import { ToggleTriggerButton } from "../ToggleTriggerButton";
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

  const optimisticToggle = useCallback(
    (nextActive: boolean) => {
      if (nextActive) {
        postToFrame(iframeRef.current, {
          type: "show",
          data: { playerId: pinnedPlayerId },
        });
      } else {
        postToFrame(iframeRef.current, { type: "hide" });
      }
    },
    [pinnedPlayerId],
  );

  return (
    <ControlCard
      overlayKey="19-player-squads"
      sessionId={sessionId}
      viewToken={viewToken}
      onIframeReady={onIframeReady}
      active={active}
      triggerSlot={
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
          <ToggleTriggerButton
            overlayKey="19-player-squads"
            sessionId={sessionId}
            active={active}
            onOptimisticToggle={optimisticToggle}
            payloadFields={
              <input
                type="hidden"
                name="payload"
                value={JSON.stringify({ playerId: pinnedPlayerId })}
              />
            }
          />
        </div>
      }
    />
  );
}
