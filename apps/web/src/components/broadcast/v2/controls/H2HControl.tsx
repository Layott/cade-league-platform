"use client";

import { useCallback, useRef, useState } from "react";
import { ControlCard, postToFrame } from "../ControlCard";
import { TriggerEnterForm, TriggerOffForm } from "../TriggerButtons";
import { PlayerSelect } from "../PlayerSelect";
import { V2_PLAYER_NAMES, type V2PlayerSlug } from "../players";
import type { V2OverlayKey } from "../overlay-keys";

/**
 * Plan 51 — generic H2H control (2 / 3 / 5 player variants).
 *
 * The 13-player roster powers each dropdown. ENTER posts a `players`
 * array of `{ displayName }` objects matching the legacy h2h_*Schema
 * shape from server/overlays/schemas.ts. Live preview uses the v2-
 * mockup-compatible payload (slug + name) so the iframe HTML can render
 * the right photo without a round-trip.
 */
export type H2HControlProps = {
  sessionId: string;
  viewToken: string | null;
  overlayKey: V2OverlayKey;
  count: 2 | 3 | 5;
  defaultSlugs: V2PlayerSlug[];
};

export function H2HControl({
  sessionId,
  viewToken,
  overlayKey,
  count,
  defaultSlugs,
}: H2HControlProps) {
  const [slugs, setSlugs] = useState<V2PlayerSlug[]>(() =>
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

  return (
    <ControlCard
      overlayKey={overlayKey}
      sessionId={sessionId}
      viewToken={viewToken}
      onIframeReady={onIframeReady}
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
        <div className="flex w-full items-center gap-2">
          <TriggerEnterForm
            overlayKey={overlayKey}
            sessionId={sessionId}
            payloadFields={
              <input type="hidden" name="payload" value={payloadJson} />
            }
          />
          <TriggerOffForm overlayKey={overlayKey} sessionId={sessionId} />
        </div>
      }
    />
  );
}
