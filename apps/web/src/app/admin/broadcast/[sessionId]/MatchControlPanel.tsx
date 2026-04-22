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
 * Plan 42 / 42.1 — match-aware overlay control panel.
 *
 * CADE broadcasts TWO concurrent matches — a `primary` (on-stream) and a
 * `secondary` (off-stream). This panel renders two independent slot cards
 * side-by-side. Each card drives its own match via the `slot` form field.
 *
 * Pure server component — each button is its own form posting to a server
 * action in `../actions.ts`. Actions gate on `broadcast.match_control`.
 *
 * The match clock below these cards is session-scoped (shared across both
 * slots) per Plan 42.1 spec.
 */

export type CurrentMatchDigest = {
  slot: "primary" | "secondary";
  matchId: string;
  homeDisplayName: string;
  awayDisplayName: string;
  homeScore: number;
  awayScore: number;
};

export function MatchControlPanel({
  sessionId,
  selectable,
  primaryCurrent,
  secondaryCurrent,
  isLive,
}: {
  sessionId: string;
  selectable: SelectableMatch[];
  primaryCurrent: CurrentMatchDigest | null;
  secondaryCurrent: CurrentMatchDigest | null;
  isLive: boolean;
}) {
  return (
    <div className="space-y-3" data-testid="match-control-panel">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-display text-sm font-bold text-[var(--chalk-0)]">
            Match Control — Dual Slot
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Run primary (on-stream) + secondary (off-stream) simultaneously
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SlotCard
          sessionId={sessionId}
          slot="primary"
          slotLabel="Primary Match"
          slotHint="LIVE ON STREAM"
          accent="var(--signal)"
          selectable={selectable}
          // Don't let the same match be pinned to both slots.
          blockedMatchIds={secondaryCurrent ? [secondaryCurrent.matchId] : []}
          current={primaryCurrent}
          isLive={isLive}
        />
        <SlotCard
          sessionId={sessionId}
          slot="secondary"
          slotLabel="Secondary Match"
          slotHint="OFF STREAM"
          accent="var(--flare)"
          selectable={selectable}
          blockedMatchIds={primaryCurrent ? [primaryCurrent.matchId] : []}
          current={secondaryCurrent}
          isLive={isLive}
        />
      </div>
    </div>
  );
}

function SlotCard({
  sessionId,
  slot,
  slotLabel,
  slotHint,
  accent,
  selectable,
  blockedMatchIds,
  current,
  isLive,
}: {
  sessionId: string;
  slot: "primary" | "secondary";
  slotLabel: string;
  slotHint: string;
  accent: string;
  selectable: SelectableMatch[];
  blockedMatchIds: string[];
  current: CurrentMatchDigest | null;
  isLive: boolean;
}) {
  const hasCurrent = current !== null;
  const status: "scheduled" | "in_progress" | "completed" = hasCurrent
    ? "in_progress"
    : "scheduled";
  const overlayUrl = `/overlay/score-bug?session=${encodeURIComponent(
    sessionId,
  )}&slot=${slot}`;

  return (
    <div
      className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4"
      data-testid={`match-slot-${slot}`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div
            className="font-display text-sm font-bold"
            style={{ color: accent }}
          >
            {slotLabel}
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            {slotHint}
          </div>
        </div>
        <div className="text-right">
          {hasCurrent ? (
            <>
              <div
                className="font-display text-2xl font-bold tabular-nums"
                style={{ color: accent }}
                data-testid={`slot-${slot}-score`}
              >
                {current!.homeScore} : {current!.awayScore}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
                <StatusChip status={status} />
              </div>
            </>
          ) : (
            <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
              <StatusChip status={status} />
            </div>
          )}
        </div>
      </div>

      {/* --- Match selector + Start match --------------------------------- */}
      <form
        action={selectAndStartMatchAction}
        className="grid gap-2 md:grid-cols-[1fr_auto]"
        data-testid={`match-start-form-${slot}`}
      >
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="slot" value={slot} />
        <select
          name="matchId"
          className={inputClass}
          defaultValue={current?.matchId ?? ""}
          data-testid={`match-select-${slot}`}
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
            const isBlocked = blockedMatchIds.includes(m.id);
            return (
              <option
                key={m.id}
                value={m.id}
                disabled={
                  m.status === "completed" ||
                  m.status === "voided" ||
                  isBlocked
                }
              >
                {isBlocked ? `${label} · (in other slot)` : label}
              </option>
            );
          })}
        </select>
        <PrimaryButton
          type="submit"
          size="sm"
          disabled={!isLive || hasCurrent}
          data-testid={`match-start-btn-${slot}`}
        >
          Start match
        </PrimaryButton>
      </form>

      {/* --- Player autofill preview -------------------------------------- */}
      {hasCurrent ? (
        <div
          className="mt-3 rounded-sm border border-[var(--ink-4)]/60 bg-[var(--ink-3)]/40 p-2"
          data-testid={`slot-${slot}-players`}
        >
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <div className="text-xs font-semibold text-[var(--chalk-1)]">
              {current!.homeDisplayName}
              <span className="ml-2 rounded-sm bg-[var(--ink-4)]/50 px-1 py-0.5 text-[9px] uppercase tracking-[0.14em] text-[var(--chalk-3)]">
                auto
              </span>
            </div>
            <div className="text-[9px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              vs
            </div>
            <div className="text-right text-xs font-semibold text-[var(--chalk-1)]">
              {current!.awayDisplayName}
              <span className="ml-2 rounded-sm bg-[var(--ink-4)]/50 px-1 py-0.5 text-[9px] uppercase tracking-[0.14em] text-[var(--chalk-3)]">
                auto
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {/* --- Score widget ------------------------------------------------- */}
      {hasCurrent ? (
        <div
          className="mt-3 grid gap-2 rounded-sm border border-[var(--ink-4)]/60 bg-[var(--ink-3)]/40 p-3"
          data-testid={`score-widget-${slot}`}
        >
          <div className="grid grid-cols-2 gap-2">
            <ScoreSide
              sessionId={sessionId}
              slot={slot}
              side="home"
              name={current!.homeDisplayName}
              score={current!.homeScore}
              isLive={isLive}
            />
            <ScoreSide
              sessionId={sessionId}
              slot={slot}
              side="away"
              name={current!.awayDisplayName}
              score={current!.awayScore}
              isLive={isLive}
            />
          </div>
          <form action={resetScoreBugAction} className="flex justify-end">
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="slot" value={slot} />
            <SecondaryButton
              type="submit"
              size="sm"
              disabled={!isLive}
              data-testid={`score-reset-btn-${slot}`}
            >
              Reset 0-0
            </SecondaryButton>
          </form>
        </div>
      ) : null}

      {/* --- End match form ---------------------------------------------- */}
      {hasCurrent ? (
        <details
          className="mt-3 rounded-sm border border-[var(--ink-4)]/60 bg-[var(--ink-3)]/30 p-3"
          data-testid={`end-match-details-${slot}`}
        >
          <summary className="cursor-pointer select-none text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--flare)]">
            End match
          </summary>
          <form
            action={endMatchAction}
            className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_2fr_auto]"
            data-testid={`end-match-form-${slot}`}
          >
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="slot" value={slot} />
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              Home final
              <span className="flex items-center gap-1 normal-case text-[9px] text-[var(--chalk-3)]">
                <EditIcon /> editable
              </span>
              <input
                name="homeScore"
                type="number"
                min={0}
                defaultValue={current!.homeScore}
                className={inputClass}
                data-testid={`end-home-${slot}`}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              Away final
              <span className="flex items-center gap-1 normal-case text-[9px] text-[var(--chalk-3)]">
                <EditIcon /> editable
              </span>
              <input
                name="awayScore"
                type="number"
                min={0}
                defaultValue={current!.awayScore}
                className={inputClass}
                data-testid={`end-away-${slot}`}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              Notes (optional)
              <input
                name="notes"
                type="text"
                className={inputClass}
                data-testid={`end-notes-${slot}`}
                placeholder="e.g. confirmed via screenshot"
              />
            </label>
            <div className="flex items-end">
              <DangerButton
                type="submit"
                size="sm"
                disabled={!isLive}
                data-testid={`end-match-btn-${slot}`}
              >
                End match
              </DangerButton>
            </div>
          </form>
        </details>
      ) : null}

      {/* --- Copy overlay URL with ?slot= -------------------------------- */}
      <div className="mt-3 flex items-center justify-between gap-2 rounded-sm border border-[var(--ink-4)]/40 bg-[var(--ink-3)]/20 p-2">
        <code
          className="truncate font-mono text-[10px] text-[var(--chalk-2)]"
          data-testid={`slot-${slot}-overlay-url`}
        >
          {overlayUrl}
        </code>
        <a
          href={overlayUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-nowrap rounded-sm border border-[var(--signal)]/45 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--signal)] hover:bg-[var(--signal)]/12"
        >
          Open ↗
        </a>
      </div>
    </div>
  );
}

function StatusChip({
  status,
}: {
  status: "scheduled" | "in_progress" | "completed";
}) {
  const color =
    status === "in_progress"
      ? "var(--signal)"
      : status === "completed"
        ? "var(--chalk-3)"
        : "var(--chalk-2)";
  const label =
    status === "in_progress"
      ? "in progress"
      : status === "completed"
        ? "completed"
        : "scheduled";
  return (
    <span
      className="rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.22em]"
      style={{ borderColor: `${color}66`, color }}
    >
      {label}
    </span>
  );
}

function EditIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ display: "inline-block", verticalAlign: "-1px" }}
    >
      <path
        d="M12 2l2 2-8 8H4v-2l8-8z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ScoreSide({
  sessionId,
  slot,
  side,
  name,
  score,
  isLive,
}: {
  sessionId: string;
  slot: "primary" | "secondary";
  side: "home" | "away";
  name: string;
  score: number;
  isLive: boolean;
}) {
  return (
    <div
      className="rounded-sm border border-[var(--ink-4)]/50 bg-[var(--ink-2)] p-2"
      data-testid={`score-side-${slot}-${side}`}
    >
      <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
        {side}
      </div>
      <div className="mt-1 font-display text-lg font-bold text-[var(--chalk-0)]">
        {name}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div
          className="font-display text-3xl font-bold text-[var(--signal)] tabular-nums"
          data-testid={`score-${slot}-${side}`}
        >
          {score}
        </div>
        <div className="flex flex-1 justify-end gap-1">
          <form action={scoreBugDeltaAction}>
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="slot" value={slot} />
            <input type="hidden" name="side" value={side} />
            <input type="hidden" name="delta" value="1" />
            <PrimaryButton
              type="submit"
              size="sm"
              disabled={!isLive}
              data-testid={`score-${slot}-${side}-plus`}
            >
              +1
            </PrimaryButton>
          </form>
          <form action={scoreBugDeltaAction}>
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="slot" value={slot} />
            <input type="hidden" name="side" value={side} />
            <input type="hidden" name="delta" value="-1" />
            <SecondaryButton
              type="submit"
              size="sm"
              disabled={!isLive || score === 0}
              data-testid={`score-${slot}-${side}-minus`}
            >
              −1
            </SecondaryButton>
          </form>
        </div>
      </div>
    </div>
  );
}
