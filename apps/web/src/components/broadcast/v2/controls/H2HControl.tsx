"use client";

import { useCallback, useRef } from "react";
import { ControlCard, postToFrame } from "../ControlCard";
import { ReTriggerHideButtons } from "../ReTriggerHideButtons";
import { PlayerSelect } from "../PlayerSelect";
import { usePersistedState } from "../use-persisted-state";
import { V2_PLAYER_NAMES, type V2PlayerSlug } from "../players";
import type { V2OverlayKey } from "../overlay-keys";

/**
 * Plan 51 — generic H2H control (2 / 3 / 5 player variants).
 *
 * The 13-player roster powers each dropdown. EDITABLE control — clicking
 * "Trigger" always re-fires the current payload (clear-then-trigger) so
 * swapping a player and re-clicking replays the entry animation with the
 * new lineup. "Hide" clears without re-firing.
 *
 * Payload shape: `players` array of `{ displayName }` objects matching
 * the legacy h2h_*Schema shape from server/overlays/schemas.ts. Live
 * preview uses the v2-mockup-compatible payload (slug + name).
 */
export type H2HControlProps = {
  sessionId: string;
  viewToken: string | null;
  overlayKey: V2OverlayKey;
  count: 2 | 3 | 5;
  defaultSlugs: V2PlayerSlug[];
  active?: boolean;
};

export function H2HControl({
  sessionId,
  viewToken,
  overlayKey,
  count,
  defaultSlugs,
  active = false,
}: H2HControlProps) {
  const [slugs, setSlugs] = usePersistedState<V2PlayerSlug[]>(
    `v2-h2h:${sessionId}:${overlayKey}:slugs`,
    defaultSlugs.slice(0, count),
  );
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const onIframeReady = useCallback((el: HTMLIFrameElement | null) => {
    iframeRef.current = el;
  }, []);

  const updateSlug = (idx: number, slug: V2PlayerSlug) => {
    const next = [...slugs];
    next[idx] = slug;
    setSlugs(next);
    postToFrame(iframeRef.current, {
      type: "update",
      data: {
        players: next.map((s) => ({ slug: s, name: V2_PLAYER_NAMES[s] })),
      },
    });
  };

  // Persistent payload uses the legacy h2h_* schema's `players[].displayName`
  // shape so the existing Zod validator passes.
  const payloadJson = JSON.stringify({
    players: slugs.map((s) => ({ displayName: V2_PLAYER_NAMES[s] })),
  });

  // Optimistic — postMessage v2-mockup-shape payload (slug + name) to the
  // preview iframe instantly on Trigger click so the operator sees the
  // entry animation before the server round-trip lands.
  const optimisticTrigger = useCallback(() => {
    postToFrame(iframeRef.current, {
      type: "show",
      data: {
        players: slugs.map((s) => ({ slug: s, name: V2_PLAYER_NAMES[s] })),
      },
    });
  }, [slugs]);

  const optimisticHide = useCallback(() => {
    postToFrame(iframeRef.current, { type: "hide" });
  }, []);

  return (
    <ControlCard
      overlayKey={overlayKey}
      sessionId={sessionId}
      viewToken={viewToken}
      onIframeReady={onIframeReady}
      liveBadge={active}
      editPanel={
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: count }, (_, i) => (
            <PlayerSelect
              key={i}
              name={`h2h-player-${i}`}
              label={`Player ${i + 1}`}
              value={slugs[i]}
              onChange={(slug) => updateSlug(i, slug)}
              testId={`v2-h2h-${count}-player-${i}`}
            />
          ))}
        </div>
      }
      triggerSlot={
        <ReTriggerHideButtons
          overlayKey={overlayKey}
          sessionId={sessionId}
          active={active}
          onOptimisticTrigger={optimisticTrigger}
          onOptimisticHide={optimisticHide}
          payloadFields={
            <input type="hidden" name="payload" value={payloadJson} />
          }
        />
      }
    />
  );
}
