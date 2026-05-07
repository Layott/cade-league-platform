"use client";

import { useState, useTransition } from "react";
import { formatWat } from "@/lib/time";
import type { MatchDayScheduleOverride } from "@/server/squads/schedule_overrides";

/**
 * Per-match-day SCHEDULE override controls — admin can shift the
 * Thursday submission deadline + Friday change-window times for a
 * specific match day. Each time field is independently nullable so
 * admin can shift just one boundary; the Friday 21:00-22:00 default
 * stays automatic when not overridden.
 *
 * Orthogonal to the force_open / force_close toggle in
 * `SquadMatchDayWindowControls` — this lets admin TUNE the times
 * without flipping the force toggle. Both can be active at once.
 */

export type ScheduleOverrideRow = {
  id: string;
  matchDate: string; // yyyy-MM-dd
  venueName: string;
  status: string;
  matchCount: number;
  weekStart: string; // yyyy-MM-dd Thursday anchor for fallback display
  override: MatchDayScheduleOverride | null;
  // Hardcoded fallback values for placeholder display when override is null.
  // 2026-05-07 — submission_open_at has no time-based default (window
  // opens "from forever"); show empty placeholder for the open-at input.
  defaultSubmissionOpenAt: string | null;
  defaultSubmissionDeadlineAt: string; // ISO
  defaultChangeWindowOpenAt: string; // ISO
  defaultChangeWindowCloseAt: string; // ISO
};

type SetActionFn = (formData: FormData) => Promise<void>;
type ClearActionFn = (formData: FormData) => Promise<void>;

type Props = {
  rows: ScheduleOverrideRow[];
  setAction: SetActionFn;
  clearAction: ClearActionFn;
};

const TESTID = {
  root: "schedule-override-controls",
  row: (id: string) => `schedule-override-row-${id}`,
  open: (id: string) => `schedule-override-open-${id}`,
  deadline: (id: string) => `schedule-override-deadline-${id}`,
  changeOpen: (id: string) => `schedule-override-change-open-${id}`,
  changeClose: (id: string) => `schedule-override-change-close-${id}`,
  notes: (id: string) => `schedule-override-notes-${id}`,
  saveBtn: (id: string) => `schedule-override-save-${id}`,
  clearBtn: (id: string) => `schedule-override-clear-${id}`,
  state: (id: string) => `schedule-override-state-${id}`,
  error: "schedule-override-error",
};

/**
 * Convert an ISO timestamp to a `YYYY-MM-DDTHH:mm` string in WAT for
 * the datetime-local input value. Africa/Lagos is +01:00 year-round
 * so we can compute by shifting +1h from UTC and slicing.
 */
function toWatLocalInput(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const watMs = ms + 60 * 60 * 1000; // +01:00
  const watIso = new Date(watMs).toISOString();
  // YYYY-MM-DDTHH:mm
  return watIso.slice(0, 16);
}

function isOverrideActive(o: MatchDayScheduleOverride | null): boolean {
  if (!o) return false;
  return (
    o.submissionOpenAt != null ||
    o.submissionDeadlineAt != null ||
    o.changeWindowOpenAt != null ||
    o.changeWindowCloseAt != null
  );
}

function ScheduleOverrideRowEditor({
  row,
  setAction,
  clearAction,
}: {
  row: ScheduleOverrideRow;
  setAction: SetActionFn;
  clearAction: ClearActionFn;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [openAt, setOpenAt] = useState(
    toWatLocalInput(row.override?.submissionOpenAt ?? null),
  );
  const [deadline, setDeadline] = useState(
    toWatLocalInput(row.override?.submissionDeadlineAt ?? null),
  );
  const [changeOpen, setChangeOpen] = useState(
    toWatLocalInput(row.override?.changeWindowOpenAt ?? null),
  );
  const [changeClose, setChangeClose] = useState(
    toWatLocalInput(row.override?.changeWindowCloseAt ?? null),
  );
  const [notes, setNotes] = useState(row.override?.notes ?? "");
  const isActive = isOverrideActive(row.override);

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("matchDayId", row.id);
        if (openAt) fd.set("submissionOpenAt", openAt);
        if (deadline) fd.set("submissionDeadlineAt", deadline);
        if (changeOpen) fd.set("changeWindowOpenAt", changeOpen);
        if (changeClose) fd.set("changeWindowCloseAt", changeClose);
        if (notes) fd.set("notes", notes);
        await setAction(fd);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Save failed";
        if (msg.toLowerCase().includes("next_redirect")) return;
        setError(msg);
      }
    });
  }

  function clear() {
    setError(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("matchDayId", row.id);
        await clearAction(fd);
        setOpenAt("");
        setDeadline("");
        setChangeOpen("");
        setChangeClose("");
        setNotes("");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Clear failed";
        if (msg.toLowerCase().includes("next_redirect")) return;
        setError(msg);
      }
    });
  }

  return (
    <tr
      className="border-b border-[var(--ink-3)] last:border-0 align-top"
      data-testid={TESTID.row(row.id)}
    >
      <td className="py-3 pr-3 font-mono tabular text-[var(--chalk-0)]">
        <div className="font-display font-semibold">{row.matchDate}</div>
        <div className="text-[10px] text-[var(--chalk-3)]">
          {row.venueName} · {row.matchCount} match
          {row.matchCount === 1 ? "" : "es"}
        </div>
        <div className="mt-1">
          <span
            className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] ${
              isActive
                ? "border-[rgba(107,205,6,0.45)] bg-[rgba(107,205,6,0.12)] text-[var(--signal)]"
                : "border-[var(--ink-4)] bg-[var(--ink-1)] text-[var(--chalk-3)]"
            }`}
            data-testid={TESTID.state(row.id)}
            data-state={isActive ? "override" : "default"}
          >
            {isActive ? "Override" : "Auto"}
          </span>
        </div>
      </td>
      <td className="py-3 pr-3">
        <label className="block">
          <span className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]">
            Submission opens (WAT)
          </span>
          <input
            type="datetime-local"
            value={openAt}
            onChange={(e) => setOpenAt(e.target.value)}
            className="w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1 text-xs text-[var(--chalk-0)] focus:border-[var(--signal)] focus:outline-none"
            data-testid={TESTID.open(row.id)}
          />
          <span className="mt-1 block font-mono text-[9px] text-[var(--chalk-3)]">
            Default: open from forever
          </span>
        </label>
      </td>
      <td className="py-3 pr-3">
        <label className="block">
          <span className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]">
            Submission closes (deadline, WAT)
          </span>
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            placeholder={toWatLocalInput(row.defaultSubmissionDeadlineAt)}
            className="w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1 text-xs text-[var(--chalk-0)] focus:border-[var(--signal)] focus:outline-none"
            data-testid={TESTID.deadline(row.id)}
          />
          <span className="mt-1 block font-mono text-[9px] text-[var(--chalk-3)]">
            Default Thu 10:00 WAT (
            {formatWat(row.defaultSubmissionDeadlineAt, "MMM d HH:mm")})
          </span>
        </label>
      </td>
      <td className="py-3 pr-3">
        <label className="block">
          <span className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]">
            Change window open (WAT)
          </span>
          <input
            type="datetime-local"
            value={changeOpen}
            onChange={(e) => setChangeOpen(e.target.value)}
            placeholder={toWatLocalInput(row.defaultChangeWindowOpenAt)}
            className="w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1 text-xs text-[var(--chalk-0)] focus:border-[var(--signal)] focus:outline-none"
            data-testid={TESTID.changeOpen(row.id)}
          />
          <span className="mt-1 block font-mono text-[9px] text-[var(--chalk-3)]">
            Default Fri 21:00 WAT
          </span>
        </label>
      </td>
      <td className="py-3 pr-3">
        <label className="block">
          <span className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]">
            Change window close (WAT)
          </span>
          <input
            type="datetime-local"
            value={changeClose}
            onChange={(e) => setChangeClose(e.target.value)}
            placeholder={toWatLocalInput(row.defaultChangeWindowCloseAt)}
            className="w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1 text-xs text-[var(--chalk-0)] focus:border-[var(--signal)] focus:outline-none"
            data-testid={TESTID.changeClose(row.id)}
          />
          <span className="mt-1 block font-mono text-[9px] text-[var(--chalk-3)]">
            Default Fri 22:00 WAT
          </span>
        </label>
      </td>
      <td className="py-3 pr-3">
        <label className="block">
          <span className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]">
            Notes
          </span>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={400}
            placeholder="reason / context"
            className="w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1 text-xs text-[var(--chalk-0)] focus:border-[var(--signal)] focus:outline-none"
            data-testid={TESTID.notes(row.id)}
          />
        </label>
      </td>
      <td className="py-3 pr-3 text-right">
        <div className="flex flex-col items-stretch gap-1.5 min-w-[88px]">
          <button
            type="button"
            onClick={save}
            disabled={
              pending ||
              (!openAt && !deadline && !changeOpen && !changeClose)
            }
            data-testid={TESTID.saveBtn(row.id)}
            className="inline-flex items-center justify-center rounded-sm border border-[var(--primary)] bg-[var(--primary)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--primary-ink)] transition-colors hover:bg-[#82e21a] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? "..." : "Save"}
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={!isActive || pending}
            data-testid={TESTID.clearBtn(row.id)}
            className="inline-flex items-center justify-center rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--chalk-1)] transition-colors hover:border-[var(--chalk-1)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Clear
          </button>
        </div>
        {error ? (
          <p
            className="mt-2 max-w-[180px] rounded-sm border border-[rgba(255,91,59,0.45)] bg-[rgba(255,91,59,0.08)] p-1.5 text-left text-[10px] text-[var(--flare)]"
            data-testid={TESTID.error}
          >
            {error}
          </p>
        ) : null}
      </td>
    </tr>
  );
}

export function ScheduleOverrideControls({
  rows,
  setAction,
  clearAction,
}: Props) {
  return (
    <details
      className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4"
      data-testid={TESTID.root}
      open
    >
      <summary className="cursor-pointer list-none">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--chalk-3)]">
              Per-match-day submission schedule
            </div>
            <p className="mt-1 text-xs text-[var(--chalk-2)]">
              Set when submissions OPEN + CLOSE for each match day. Players
              can only submit between those times. Leave open blank for
              &ldquo;from forever&rdquo;; leave close blank for the default
              Thursday 10:00 WAT deadline. Friday change-window times stay
              automatic (21:00-22:00 WAT) when blank.
            </p>
          </div>
          <span className="text-[11px] text-[var(--chalk-3)]">
            {rows.filter((r) => isOverrideActive(r.override)).length}/
            {rows.length} active
          </span>
        </div>
      </summary>

      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--chalk-3)]">
          No upcoming match days.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--ink-4)] text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                <th className="py-2 pr-3">Match day</th>
                <th className="py-2 pr-3">Submission opens</th>
                <th className="py-2 pr-3">Submission closes</th>
                <th className="py-2 pr-3">Change window open</th>
                <th className="py-2 pr-3">Change window close</th>
                <th className="py-2 pr-3">Notes</th>
                <th className="py-2 pr-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <ScheduleOverrideRowEditor
                  key={row.id}
                  row={row}
                  setAction={setAction}
                  clearAction={clearAction}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
