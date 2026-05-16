"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ControlCard, postToFrame } from "../ControlCard";
import { ReTriggerHideButtons } from "../ReTriggerHideButtons";
import { PlayerSelect } from "../PlayerSelect";
import { V2_PLAYER_NAMES, type V2PlayerSlug } from "../players";
import type { SimpleControlProps } from "./BrbControl";

/**
 * 2026-05-16 — persist operator-typed fields across router refreshes.
 *
 * ControlGrid calls router.refresh() on every overlay.triggered /
 * overlay.cleared Realtime event so the per-card `active` flag flips
 * its toggle button colour. The refresh re-runs the page tree which
 * remounts the per-card controls — and that wipes whatever the
 * operator just typed into the OTHER cards (player picks, scores,
 * h2h slot players, etc.). The operator was losing the entire
 * score-bug entry every time another overlay fired.
 *
 * Mitigation: snapshot the local UI state to localStorage on every
 * change, keyed by sessionId, and hydrate from it on mount. State is
 * scoped per-session so swapping match-day sessions doesn't drag the
 * previous session's picks into the new one.
 */
type ScoreBugPersist = {
  aSlug: V2PlayerSlug;
  bSlug: V2PlayerSlug;
  aScore: number;
  bScore: number;
};

function loadPersisted(sessionId: string): ScoreBugPersist | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`v2-scorebug:${sessionId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ScoreBugPersist>;
    if (
      typeof parsed.aSlug !== "string" ||
      typeof parsed.bSlug !== "string"
    )
      return null;
    return {
      aSlug: parsed.aSlug as V2PlayerSlug,
      bSlug: parsed.bSlug as V2PlayerSlug,
      aScore: typeof parsed.aScore === "number" ? parsed.aScore : 0,
      bScore: typeof parsed.bScore === "number" ? parsed.bScore : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Plan 51 — secondary score bug control.
 *
 * Two-player face-off. Score inputs default to 0 — operator types live
 * score. EDITABLE control — clicking "Trigger" always re-fires the
 * current payload (clear-then-trigger), so updating a score and
 * re-clicking replays the entry animation with the new line. "Hide"
 * clears without re-firing.
 *
 * Payload shape: legacy `score_bug` schema's `players[]` array of
 * `{ displayName, score }` (length 2).
 */
export function SecondaryScoreBugControl({
  sessionId,
  viewToken,
  active = false,
}: SimpleControlProps) {
  const persisted = loadPersisted(sessionId);
  const [aSlug, setASlug] = useState<V2PlayerSlug>(
    persisted?.aSlug ?? "baji_jnr",
  );
  const [bSlug, setBSlug] = useState<V2PlayerSlug>(
    persisted?.bSlug ?? "king_nonex",
  );
  const [aScore, setAScore] = useState<number>(persisted?.aScore ?? 0);
  const [bScore, setBScore] = useState<number>(persisted?.bScore ?? 0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Persist to localStorage on every change so router.refresh() (fired
  // by ControlGrid on every overlay.* Realtime event) doesn't wipe the
  // operator's typed scores when remounting the card.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        `v2-scorebug:${sessionId}`,
        JSON.stringify({ aSlug, bSlug, aScore, bScore }),
      );
    } catch {
      /* quota / blocked — best-effort */
    }
  }, [sessionId, aSlug, bSlug, aScore, bScore]);

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

  // Persistent payload mirrors legacy scoreBugSchema + carries slug so
  // ambient OBS browser sources can resolve player photos via the same
  // slug map the broadcast preview uses.
  const payloadJson = JSON.stringify({
    players: [
      { displayName: V2_PLAYER_NAMES[aSlug], slug: aSlug, score: aScore },
      { displayName: V2_PLAYER_NAMES[bSlug], slug: bSlug, score: bScore },
    ],
  });

  // Optimistic — postMessage v2-mockup-shape payload (playerA / playerB)
  // synchronously on Trigger click so the score-bug entry animation runs
  // before the server round-trip lands.
  const optimisticTrigger = useCallback(() => {
    postToFrame(iframeRef.current, {
      type: "show",
      data: {
        playerA: { name: V2_PLAYER_NAMES[aSlug], slug: aSlug, score: aScore },
        playerB: { name: V2_PLAYER_NAMES[bSlug], slug: bSlug, score: bScore },
      },
    });
  }, [aSlug, bSlug, aScore, bScore]);

  const optimisticHide = useCallback(() => {
    postToFrame(iframeRef.current, { type: "hide" });
  }, []);

  return (
    <ControlCard
      overlayKey="09-secondary-score-bug"
      sessionId={sessionId}
      viewToken={viewToken}
      onIframeReady={onIframeReady}
      liveBadge={active}
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
        <ReTriggerHideButtons
          overlayKey="09-secondary-score-bug"
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
