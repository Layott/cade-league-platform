"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ControlCard, postToFrame } from "../ControlCard";
import { TriggerEnterForm, TriggerOffForm } from "../TriggerButtons";
import type { SimpleControlProps } from "./BrbControl";

/**
 * Plan 51 — Up Next bug control.
 *
 * Renders a dropdown of upcoming matches from the current match-day. The
 * match list is fetched server-side by the page and passed in via the
 * `upcoming` prop. ENTER fires the legacy `up_next_bug` payload with
 * `home` + `away` + `kickoffAt` ISO datetime.
 */
export type UpcomingMatch = {
  matchId: string;
  homeName: string;
  awayName: string;
  /** ISO datetime; falls back to now+10min when scheduled_time is null. */
  kickoffAt: string;
};

export type UpNextBugControlProps = SimpleControlProps & {
  upcoming: ReadonlyArray<UpcomingMatch>;
};

export function UpNextBugControl({
  sessionId,
  viewToken,
  upcoming,
}: UpNextBugControlProps) {
  const [matchId, setMatchId] = useState<string>(
    upcoming[0]?.matchId ?? "",
  );
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const onIframeReady = useCallback((el: HTMLIFrameElement | null) => {
    iframeRef.current = el;
  }, []);

  const selected = useMemo<UpcomingMatch | null>(
    () => upcoming.find((m) => m.matchId === matchId) ?? null,
    [matchId, upcoming],
  );

  const previewUpdate = useCallback(
    (m: UpcomingMatch | null) => {
      if (!m) return;
      postToFrame(iframeRef.current, {
        type: "update",
        data: {
          player1: { name: m.homeName },
          player2: { name: m.awayName },
        },
      });
    },
    [],
  );

  // Build legacy upNextBugSchema-shaped payload — home/away PlayerLite +
  // kickoffAt ISO datetime.
  const payloadJson = JSON.stringify({
    home: selected
      ? { displayName: selected.homeName }
      : { displayName: "TBD" },
    away: selected
      ? { displayName: selected.awayName }
      : { displayName: "TBD" },
    kickoffAt:
      selected?.kickoffAt ??
      new Date(Date.now() + 10 * 60_000).toISOString(),
  });

  return (
    <ControlCard
      overlayKey="10-up-next-bug"
      sessionId={sessionId}
      viewToken={viewToken}
      onIframeReady={onIframeReady}
      editPanel={
        upcoming.length === 0 ? (
          <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--chalk-3)]">
            No upcoming matches in the current match-day.
          </p>
        ) : (
          <label className="flex flex-col gap-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]">
            Up Next match
            <select
              value={matchId}
              onChange={(e) => {
                const next = e.target.value;
                setMatchId(next);
                const m = upcoming.find((x) => x.matchId === next) ?? null;
                previewUpdate(m);
              }}
              data-testid="v2-upnext-match"
              className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1.5 font-mono text-[11px] text-[var(--chalk-1)] focus:border-[var(--signal)] focus:outline-none"
            >
              {upcoming.map((m) => (
                <option key={m.matchId} value={m.matchId}>
                  {m.homeName} vs {m.awayName}
                </option>
              ))}
            </select>
          </label>
        )
      }
      triggerSlot={
        <div className="flex w-full items-center gap-2">
          <TriggerEnterForm
            overlayKey="10-up-next-bug"
            sessionId={sessionId}
            canEnter={upcoming.length > 0}
            payloadFields={
              <input type="hidden" name="payload" value={payloadJson} />
            }
          />
          <TriggerOffForm
            overlayKey="10-up-next-bug"
            sessionId={sessionId}
          />
        </div>
      }
    />
  );
}
