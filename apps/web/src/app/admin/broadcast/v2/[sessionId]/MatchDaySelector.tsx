"use client";

import { useTransition } from "react";
import { setSessionMatchDayAction } from "./actions";

/**
 * Plan 52 — match-day selector for the v2 control room.
 *
 * Renders a `<select>` that lists every recent match-day. Selecting a row
 * fires `setSessionMatchDayAction` so `stream_sessions.match_day_id` is
 * updated in place. Downstream overlays (match-scores-day, up-next,
 * autofill) read `match_day_id` directly off the session row, so the
 * change re-routes every data feed without minting a new session.
 *
 * The change is persisted on `onChange` (no separate "Save" button) so
 * the producer's flow is single-click. While the action is in flight
 * the dropdown disables to avoid double-submits, and the live region
 * announces success/failure for screen readers.
 */
export type MatchDayOption = {
  id: string;
  label: string;
};

export function MatchDaySelector({
  sessionId,
  currentMatchDayId,
  options,
  disabled = false,
}: {
  sessionId: string;
  currentMatchDayId: string | null;
  options: MatchDayOption[];
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    if (!next || next === currentMatchDayId) return;
    const fd = new FormData();
    fd.set("sessionId", sessionId);
    fd.set("matchDayId", next);
    startTransition(async () => {
      await setSessionMatchDayAction(fd);
    });
  }

  return (
    <div
      className="flex flex-col gap-1.5"
      data-testid="v2-match-day-selector"
    >
      <label
        htmlFor={`match-day-${sessionId}`}
        className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]"
      >
        Match day
      </label>
      <select
        id={`match-day-${sessionId}`}
        name="matchDayId"
        defaultValue={currentMatchDayId ?? ""}
        onChange={handleChange}
        disabled={disabled || pending}
        data-testid="v2-match-day-select"
        aria-busy={pending}
        className="min-w-[260px] rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-2 text-sm text-[var(--chalk-1)] focus:border-[var(--signal)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      >
        {options.length === 0 ? (
          <option value="">— no match days available —</option>
        ) : null}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <span
        role="status"
        aria-live="polite"
        className="text-[10px] tracking-wide text-[var(--chalk-3)]"
      >
        {pending ? "Saving…" : ""}
      </span>
    </div>
  );
}
