import {
  PrimaryButton,
  SecondaryButton,
  DangerButton,
} from "@/components/admin/buttons";
import { formatWat } from "@/lib/time";
import type { ClockState } from "@/server/overlays/match_clock";
import {
  startClockAction,
  pauseClockAction,
  resumeClockAction,
  adjustClockAction,
  resetClockAction,
} from "../actions";
import { StructuredMatchClockForm } from "./forms/StructuredMatchClockForm";

/**
 * Plan 37 / Plan 45 — match-clock control panel.
 *
 * Single row of controls bound to the per-session match_clock row. Plan 45
 * swapped the raw `secondsRemaining` number input for minutes + seconds
 * fields via `<StructuredMatchClockForm>`. Live state shown as a static
 * snapshot (server-rendered); the overlay tab uses `useMatchClock` for the
 * realtime tick.
 */

export function MatchClockPanel({
  sessionId,
  clock,
  isLive,
  instanceKey = "primary",
  title,
}: {
  sessionId: string;
  clock: ClockState | null;
  isLive: boolean;
  /** Plan 48.1 — which per-slot clock this panel controls. Defaults to
   * primary so legacy single-panel mounts stay correct. */
  instanceKey?: string;
  title?: string;
}) {
  const seconds = clock?.secondsRemaining ?? 0;
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const mmss = `${mm}:${ss}`;
  const heading = title ?? `Match Clock (${instanceKey})`;

  return (
    <div
      className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4"
      data-testid={`match-clock-panel-${instanceKey}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-display text-sm font-bold text-[var(--chalk-0)]">
            {heading}
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            /overlay/layout-timer?slot={instanceKey} (subscriber)
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

      {/* Plan 45 — structured set-clock form (minutes + seconds + label). */}
      <StructuredMatchClockForm
        sessionId={sessionId}
        isLive={isLive}
        clock={clock}
        instanceKey={instanceKey}
      />

      {/* Control buttons row */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <form action={startClockAction}>
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="instanceKey" value={instanceKey} />
          <PrimaryButton
            type="submit"
            size="sm"
            disabled={!isLive}
            data-testid={`clock-start-${instanceKey}`}
          >
            Start
          </PrimaryButton>
        </form>
        <form action={pauseClockAction}>
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="instanceKey" value={instanceKey} />
          <SecondaryButton
            type="submit"
            size="sm"
            disabled={!isLive}
            data-testid={`clock-pause-${instanceKey}`}
          >
            Pause
          </SecondaryButton>
        </form>
        <form action={resumeClockAction}>
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="instanceKey" value={instanceKey} />
          <SecondaryButton
            type="submit"
            size="sm"
            disabled={!isLive}
            data-testid={`clock-resume-${instanceKey}`}
          >
            Resume
          </SecondaryButton>
        </form>
        <form action={resetClockAction}>
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="instanceKey" value={instanceKey} />
          <DangerButton
            type="submit"
            size="sm"
            disabled={!isLive}
            data-testid={`clock-reset-${instanceKey}`}
          >
            Reset
          </DangerButton>
        </form>
        {[-60, -30, 30, 60].map((delta) => (
          <form key={delta} action={adjustClockAction}>
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="instanceKey" value={instanceKey} />
            <input type="hidden" name="deltaSeconds" value={delta} />
            <button
              type="submit"
              disabled={!isLive}
              data-testid={`clock-adjust-${instanceKey}-${delta}`}
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
