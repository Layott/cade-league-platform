"use client";

import { useState } from "react";
import { PrimaryButton, DangerButton } from "@/components/admin/buttons";
import { inputClass } from "@/components/admin/FormField";
import type { ClockState } from "@/server/overlays/match_clock";
import { setClockAction, resetClockAction } from "../../actions";

/**
 * Plan 45 — Structured match_clock form.
 *
 * Replaces the generic JSON textarea for `match_clock`-like input within
 * the editable-panel slot. Ships two number inputs (minutes / seconds) and
 * a Set button. Shows the current server-rendered clock snapshot inline
 * plus a Reset escape hatch. Intentionally a client component so on-submit
 * we can coerce the two inputs into the single `secondsRemaining` integer
 * the server action expects.
 */
export function StructuredMatchClockForm({
  sessionId,
  isLive,
  clock,
}: {
  sessionId: string;
  isLive: boolean;
  clock: ClockState | null;
}) {
  const currentSeconds = clock?.secondsRemaining ?? 0;
  const [mins, setMins] = useState<number>(Math.floor(currentSeconds / 60));
  const [secs, setSecs] = useState<number>(currentSeconds % 60);
  const [label, setLabel] = useState<string>(clock?.label ?? "");

  const totalSeconds = Math.max(
    0,
    Math.min(359999, Math.floor(mins) * 60 + Math.floor(secs)),
  );
  const mmDisp = String(Math.floor(currentSeconds / 60)).padStart(2, "0");
  const ssDisp = String(currentSeconds % 60).padStart(2, "0");

  return (
    <div className="space-y-3" data-testid="structured-match-clock">
      <div
        className="rounded-sm border border-[var(--ink-4)]/60 bg-[var(--ink-3)]/40 p-3"
        data-testid="clock-current"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
              Current
            </div>
            <div className="font-display text-xl font-bold text-[var(--signal)] tabular-nums">
              {mmDisp}:{ssDisp}
            </div>
          </div>
          <div className="text-right text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            <div>{clock?.mode ?? "no clock"}</div>
            {clock?.label ? <div>· {clock.label}</div> : null}
          </div>
        </div>
      </div>

      <form
        action={setClockAction}
        className="space-y-2"
        data-testid="structured-clock-form"
      >
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="mode" value="countdown" />
        <input
          type="hidden"
          name="secondsRemaining"
          value={totalSeconds}
          data-testid="clock-total-seconds"
        />
        <div className="grid gap-2 md:grid-cols-[1fr_1fr_2fr]">
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
            Minutes
            <input
              type="number"
              min={0}
              max={120}
              value={mins}
              onChange={(e) => setMins(Number(e.target.value) || 0)}
              className={inputClass}
              data-testid="clock-minutes"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
            Seconds
            <input
              type="number"
              min={0}
              max={59}
              value={secs}
              onChange={(e) => setSecs(Number(e.target.value) || 0)}
              className={inputClass}
              data-testid="clock-seconds"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
            Label (optional)
            <input
              type="text"
              name="label"
              maxLength={40}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. HALF-TIME"
              className={inputClass}
              data-testid="clock-label"
            />
          </label>
        </div>
        <div className="flex items-center justify-end gap-2">
          <PrimaryButton
            type="submit"
            size="sm"
            disabled={!isLive}
            data-testid="clock-set"
          >
            Set {String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:
            {String(totalSeconds % 60).padStart(2, "0")}
          </PrimaryButton>
        </div>
      </form>

      <form action={resetClockAction} className="flex justify-end">
        <input type="hidden" name="sessionId" value={sessionId} />
        <DangerButton
          type="submit"
          size="sm"
          disabled={!isLive}
          data-testid="clock-reset-form"
        >
          Reset
        </DangerButton>
      </form>
    </div>
  );
}
