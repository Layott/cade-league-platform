import {
  PrimaryButton,
  SecondaryButton,
  DangerButton,
} from "@/components/admin/buttons";
import { inputClass } from "@/components/admin/FormField";
import { formatWat } from "@/lib/time";
import type { ClockState } from "@/server/overlays/match_clock";
import {
  setClockAction,
  startClockAction,
  pauseClockAction,
  resumeClockAction,
  adjustClockAction,
  resetClockAction,
} from "../actions";

/**
 * Plan 37 — match-clock control panel.
 *
 * Single row of controls bound to the per-session match_clock row.
 * Live state shown as a static snapshot (server-rendered); the overlay
 * tab uses `useMatchClock` for the realtime tick.
 */

export function MatchClockPanel({
  sessionId,
  clock,
  isLive,
}: {
  sessionId: string;
  clock: ClockState | null;
  isLive: boolean;
}) {
  const seconds = clock?.secondsRemaining ?? 0;
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const mmss = `${mm}:${ss}`;

  return (
    <div
      className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4"
      data-testid="match-clock-panel"
    >
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-display text-sm font-bold text-[var(--chalk-0)]">
            Match Clock
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            /overlay/layout-timer (subscriber)
          </div>
        </div>
        <div className="text-right">
          <div className="font-display text-2xl font-bold text-[var(--signal)] tabular">
            {mmss}
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            {clock?.mode ?? "no clock"}
            {clock?.label ? ` · ${clock.label}` : null}
          </div>
        </div>
      </div>

      {/* Set clock form */}
      <form
        action={setClockAction}
        className="grid gap-2 md:grid-cols-[1fr_120px_140px_auto]"
        data-testid="set-clock-form"
      >
        <input type="hidden" name="sessionId" value={sessionId} />
        <input
          type="text"
          name="label"
          placeholder="Label (e.g. WARMUP)"
          maxLength={40}
          defaultValue={clock?.label ?? ""}
          className={inputClass}
          data-testid="clock-label"
        />
        <input
          type="number"
          name="secondsRemaining"
          min={0}
          max={359999}
          placeholder="Seconds"
          defaultValue={seconds}
          className={inputClass}
          data-testid="clock-seconds"
        />
        <select
          name="mode"
          defaultValue={clock?.mode ?? "countdown"}
          className={inputClass + " appearance-none"}
          data-testid="clock-mode"
        >
          <option value="countdown">Countdown</option>
          <option value="countup">Countup</option>
          <option value="paused">Paused</option>
          <option value="stopped">Stopped</option>
        </select>
        <PrimaryButton
          type="submit"
          size="sm"
          disabled={!isLive}
          data-testid="clock-set-btn"
        >
          Set
        </PrimaryButton>
      </form>

      {/* Control buttons row */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <form action={startClockAction}>
          <input type="hidden" name="sessionId" value={sessionId} />
          <PrimaryButton
            type="submit"
            size="sm"
            disabled={!isLive}
            data-testid="clock-start"
          >
            Start
          </PrimaryButton>
        </form>
        <form action={pauseClockAction}>
          <input type="hidden" name="sessionId" value={sessionId} />
          <SecondaryButton
            type="submit"
            size="sm"
            disabled={!isLive}
            data-testid="clock-pause"
          >
            Pause
          </SecondaryButton>
        </form>
        <form action={resumeClockAction}>
          <input type="hidden" name="sessionId" value={sessionId} />
          <SecondaryButton
            type="submit"
            size="sm"
            disabled={!isLive}
            data-testid="clock-resume"
          >
            Resume
          </SecondaryButton>
        </form>
        <form action={resetClockAction}>
          <input type="hidden" name="sessionId" value={sessionId} />
          <DangerButton
            type="submit"
            size="sm"
            disabled={!isLive}
            data-testid="clock-reset"
          >
            Reset
          </DangerButton>
        </form>
        {[-60, -30, 30, 60].map((delta) => (
          <form key={delta} action={adjustClockAction}>
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="deltaSeconds" value={delta} />
            <button
              type="submit"
              disabled={!isLive}
              data-testid={`clock-adjust-${delta}`}
              className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-1)] hover:border-[var(--signal)] disabled:opacity-40"
            >
              {delta > 0 ? `+${delta}s` : `${delta}s`}
            </button>
          </form>
        ))}
      </div>

      {clock ? (
        <div className="mt-2 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
          last edit {formatWat(clock.updatedAt, "HH:mm:ss")} WAT
        </div>
      ) : null}
    </div>
  );
}
