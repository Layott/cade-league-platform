import {
  PrimaryButton,
  SecondaryButton,
  DangerButton,
} from "@/components/admin/buttons";
import { inputClass } from "@/components/admin/FormField";
import type { SelectableMatch } from "@/server/broadcast/match_flow";
import {
  selectAndStartMatchAction,
  scoreBugDeltaAction,
  resetScoreBugAction,
  endMatchAction,
} from "../actions";

/**
 * Plan 42 — match-aware overlay control panel.
 *
 * Mounted on `/admin/broadcast/[sessionId]`. Provides:
 *   1. Match select → Start match (pins the match on the session,
 *      auto-fills score_bug, initializes clock, broadcasts match.started).
 *   2. Score widget — home +1/−1, away +1/−1, reset — visible only when
 *      the session has a current_match.
 *   3. End match — inline form for final scores + optional notes.
 *
 * Pure server component (no client hooks) — each button is its own form
 * that posts to one of the server actions in `../actions.ts`. Action gate
 * resolves to `broadcast.match_control` perm.
 */

export type CurrentMatchDigest = {
  matchId: string;
  homeDisplayName: string;
  awayDisplayName: string;
  homeScore: number;
  awayScore: number;
};

export function MatchControlPanel({
  sessionId,
  selectable,
  current,
  isLive,
}: {
  sessionId: string;
  selectable: SelectableMatch[];
  /** Non-null when a match is currently pinned on the session. Drives the
   *  score widget + end-match form. */
  current: CurrentMatchDigest | null;
  isLive: boolean;
}) {
  const hasCurrent = current !== null;

  return (
    <div
      className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4"
      data-testid="match-control-panel"
    >
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-display text-sm font-bold text-[var(--chalk-0)]">
            Match Control
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Pin current match · auto-fill overlays · run score
          </div>
        </div>
        <div className="text-right">
          {hasCurrent ? (
            <>
              <div className="font-display text-2xl font-bold text-[var(--signal)] tabular-nums">
                {current!.homeScore} : {current!.awayScore}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
                live match
              </div>
            </>
          ) : (
            <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
              no match pinned
            </div>
          )}
        </div>
      </div>

      {/* --- Match selector + Start match ------------------------------- */}
      <form
        action={selectAndStartMatchAction}
        className="grid gap-2 md:grid-cols-[1fr_auto]"
        data-testid="match-start-form"
      >
        <input type="hidden" name="sessionId" value={sessionId} />
        <select
          name="matchId"
          className={inputClass}
          defaultValue={current?.matchId ?? ""}
          data-testid="match-select"
          required
          disabled={!isLive || hasCurrent}
        >
          <option value="" disabled>
            Select a match…
          </option>
          {selectable.map((m) => {
            const label = `${m.home.displayName ?? m.home.gamerTag ?? "?"} vs ${
              m.away.displayName ?? m.away.gamerTag ?? "?"
            }${m.scheduledTime ? ` · ${m.scheduledTime.slice(0, 5)}` : ""} · ${
              m.status
            }`;
            return (
              <option
                key={m.id}
                value={m.id}
                disabled={m.status === "completed" || m.status === "voided"}
              >
                {label}
              </option>
            );
          })}
        </select>
        <PrimaryButton
          type="submit"
          size="sm"
          disabled={!isLive || hasCurrent}
          data-testid="match-start-btn"
        >
          Start match
        </PrimaryButton>
      </form>

      {/* --- Score widget (visible only when a match is pinned) -------- */}
      {hasCurrent ? (
        <div
          className="mt-4 grid gap-2 rounded-sm border border-[var(--ink-4)]/60 bg-[var(--ink-3)]/40 p-3"
          data-testid="score-widget"
        >
          <div className="grid grid-cols-2 gap-2">
            <ScoreSide
              sessionId={sessionId}
              side="home"
              name={current!.homeDisplayName}
              score={current!.homeScore}
              isLive={isLive}
            />
            <ScoreSide
              sessionId={sessionId}
              side="away"
              name={current!.awayDisplayName}
              score={current!.awayScore}
              isLive={isLive}
            />
          </div>
          <form action={resetScoreBugAction} className="flex justify-end">
            <input type="hidden" name="sessionId" value={sessionId} />
            <SecondaryButton
              type="submit"
              size="sm"
              disabled={!isLive}
              data-testid="score-reset-btn"
            >
              Reset 0-0
            </SecondaryButton>
          </form>
        </div>
      ) : null}

      {/* --- End match form (visible only when a match is pinned) ------ */}
      {hasCurrent ? (
        <details
          className="mt-4 rounded-sm border border-[var(--ink-4)]/60 bg-[var(--ink-3)]/30 p-3"
          data-testid="end-match-details"
        >
          <summary className="cursor-pointer select-none text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--flare)]">
            End match
          </summary>
          <form
            action={endMatchAction}
            className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_2fr_auto]"
            data-testid="end-match-form"
          >
            <input type="hidden" name="sessionId" value={sessionId} />
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              Home final
              <input
                name="homeScore"
                type="number"
                min={0}
                defaultValue={current!.homeScore}
                className={inputClass}
                data-testid="end-home"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              Away final
              <input
                name="awayScore"
                type="number"
                min={0}
                defaultValue={current!.awayScore}
                className={inputClass}
                data-testid="end-away"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              Notes (optional)
              <input
                name="notes"
                type="text"
                className={inputClass}
                data-testid="end-notes"
                placeholder="e.g. confirmed via screenshot"
              />
            </label>
            <div className="flex items-end">
              <DangerButton
                type="submit"
                size="sm"
                disabled={!isLive}
                data-testid="end-match-btn"
              >
                End match
              </DangerButton>
            </div>
          </form>
        </details>
      ) : null}
    </div>
  );
}

function ScoreSide({
  sessionId,
  side,
  name,
  score,
  isLive,
}: {
  sessionId: string;
  side: "home" | "away";
  name: string;
  score: number;
  isLive: boolean;
}) {
  return (
    <div
      className="rounded-sm border border-[var(--ink-4)]/50 bg-[var(--ink-2)] p-2"
      data-testid={`score-side-${side}`}
    >
      <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
        {side}
      </div>
      <div className="mt-1 font-display text-xl font-bold text-[var(--chalk-0)]">
        {name}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div
          className="font-display text-3xl font-bold text-[var(--signal)] tabular-nums"
          data-testid={`score-${side}`}
        >
          {score}
        </div>
        <div className="flex flex-1 justify-end gap-1">
          <form action={scoreBugDeltaAction}>
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="side" value={side} />
            <input type="hidden" name="delta" value="1" />
            <PrimaryButton
              type="submit"
              size="sm"
              disabled={!isLive}
              data-testid={`score-${side}-plus`}
            >
              +1
            </PrimaryButton>
          </form>
          <form action={scoreBugDeltaAction}>
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="side" value={side} />
            <input type="hidden" name="delta" value="-1" />
            <SecondaryButton
              type="submit"
              size="sm"
              disabled={!isLive || score === 0}
              data-testid={`score-${side}-minus`}
            >
              −1
            </SecondaryButton>
          </form>
        </div>
      </div>
    </div>
  );
}
