"use client";

import { useCallback, useRef, useState } from "react";
import { ControlCard, postToFrame } from "../ControlCard";
import { TriggerEnterForm, TriggerOffForm } from "../TriggerButtons";
import { PlayerSelect } from "../PlayerSelect";
import { V2_PLAYER_NAMES, type V2PlayerSlug } from "../players";
import type { SimpleControlProps } from "./BrbControl";

/**
 * Plan 51 — secondary score bug control.
 *
 * Two-player face-off. Score inputs default to 0 — the operator types
 * the live score. Mirrors the static mockup `editable: 'scoreBug'`
 * inputs at v2/index.html. Live preview gets the slug + name + score
 * shape; persistent payload uses the legacy `score_bug` schema's
 * `players[]` array of `{ displayName, score }` (length 2).
 */
export function SecondaryScoreBugControl({
  sessionId,
  viewToken,
}: SimpleControlProps) {
  const [aSlug, setASlug] = useState<V2PlayerSlug>("baji_jnr");
  const [bSlug, setBSlug] = useState<V2PlayerSlug>("king_nonex");
  const [aScore, setAScore] = useState<number>(0);
  const [bScore, setBScore] = useState<number>(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const onIframeReady = useCallback((el: HTMLIFrameElement | null) => {
    iframeRef.current = el;
  }, []);

  const previewUpdate = useCallback(() => {
    postToFrame(iframeRef.current, {
      type: "update",
      data: {
        playerA: { name: V2_PLAYER_NAMES[aSlug], slug: aSlug, score: aScore },
        playerB: { name: V2_PLAYER_NAMES[bSlug], slug: bSlug, score: bScore },
      },
    });
  }, [aSlug, bSlug, aScore, bScore]);

  // Persistent payload mirrors legacy scoreBugSchema (length 2 array).
  const payloadJson = JSON.stringify({
    players: [
      { displayName: V2_PLAYER_NAMES[aSlug], score: aScore },
      { displayName: V2_PLAYER_NAMES[bSlug], score: bScore },
    ],
  });

  return (
    <ControlCard
      overlayKey="09-secondary-score-bug"
      sessionId={sessionId}
      viewToken={viewToken}
      onIframeReady={onIframeReady}
      editPanel={
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <PlayerSelect
              name="score-bug-a"
              label="Player A"
              value={aSlug}
              onChange={(s) => {
                setASlug(s);
                setTimeout(previewUpdate, 0);
              }}
              testId="v2-scorebug-player-a"
            />
            <label className="flex flex-col gap-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              Score A
              <input
                type="number"
                min={0}
                max={99}
                value={aScore}
                onChange={(e) => setAScore(Number(e.target.value) || 0)}
                onBlur={previewUpdate}
                data-testid="v2-scorebug-score-a"
                className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1.5 font-mono text-[12px] text-[var(--chalk-1)] focus:border-[var(--signal)] focus:outline-none"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <PlayerSelect
              name="score-bug-b"
              label="Player B"
              value={bSlug}
              onChange={(s) => {
                setBSlug(s);
                setTimeout(previewUpdate, 0);
              }}
              testId="v2-scorebug-player-b"
            />
            <label className="flex flex-col gap-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              Score B
              <input
                type="number"
                min={0}
                max={99}
                value={bScore}
                onChange={(e) => setBScore(Number(e.target.value) || 0)}
                onBlur={previewUpdate}
                data-testid="v2-scorebug-score-b"
                className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1.5 font-mono text-[12px] text-[var(--chalk-1)] focus:border-[var(--signal)] focus:outline-none"
              />
            </label>
          </div>
        </div>
      }
      triggerSlot={
        <div className="flex w-full items-center gap-2">
          <TriggerEnterForm
            overlayKey="09-secondary-score-bug"
            sessionId={sessionId}
            payloadFields={
              <input type="hidden" name="payload" value={payloadJson} />
            }
          />
          <TriggerOffForm
            overlayKey="09-secondary-score-bug"
            sessionId={sessionId}
          />
        </div>
      }
    />
  );
}
