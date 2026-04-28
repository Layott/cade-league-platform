"use client";

import { useState, useTransition } from "react";
import { formatWat } from "@/lib/time";
import type { SquadMatchDayWindow } from "@/server/squads/match_day_window";

/**
 * Per-MATCH-DAY admin override controls for the squad submission window.
 *
 * Lists every match day in the active season with:
 *   - A state pill (Open / Closed / Auto-from-week).
 *   - Force-open / Force-close / Clear-override buttons (each behind a
 *     confirm modal mirroring the weekly SquadWindowControls UX).
 *
 * The weekly fallback still applies for any match day with no per-match-
 * day override set ("Auto" pill).
 */

export type AdminMatchDayRow = {
  id: string;
  matchDate: string; // yyyy-MM-dd
  venueName: string;
  status: string;
  matchCount: number;
  override: SquadMatchDayWindow | null;
  // Resolver outcome at render time — used to color the pill consistently
  // with the player-facing window state.
  resolvedOpen: boolean;
  resolvedReason: string;
};

type SetActionFn = (formData: FormData) => Promise<void>;
type ClearActionFn = (formData: FormData) => Promise<void>;

type Props = {
  rows: AdminMatchDayRow[];
  setAction: SetActionFn;
  clearAction: ClearActionFn;
};

type ModalState = {
  matchDayId: string;
  matchDate: string;
  venueName: string;
  kind: "open" | "close" | "clear";
} | null;

const TESTID = {
  root: "squad-match-day-controls",
  row: (id: string) => `squad-match-day-row-${id}`,
  state: (id: string) => `squad-match-day-state-${id}`,
  openBtn: (id: string) => `squad-match-day-open-${id}`,
  closeBtn: (id: string) => `squad-match-day-close-${id}`,
  clearBtn: (id: string) => `squad-match-day-clear-${id}`,
  modal: "squad-match-day-modal",
  confirm: "squad-match-day-confirm-btn",
  cancel: "squad-match-day-cancel-btn",
  note: "squad-match-day-note",
  error: "squad-match-day-error",
};

function statePill(row: AdminMatchDayRow) {
  if (row.override?.state === "force_open") {
    return {
      tone: "bg-[rgba(107,205,6,0.12)] text-[var(--signal)] border-[rgba(107,205,6,0.45)]",
      label: "Force OPEN",
      data: "force_open",
    };
  }
  if (row.override?.state === "force_close") {
    return {
      tone: "bg-[rgba(254,3,109,0.12)] text-[var(--secondary)] border-[rgba(254,3,109,0.45)]",
      label: "Force CLOSED",
      data: "force_close",
    };
  }
  // Auto — fall through to weekly. Use resolved state to disambiguate.
  return {
    tone: row.resolvedOpen
      ? "bg-[var(--ink-1)] text-[var(--chalk-1)] border-[var(--ink-4)]"
      : "bg-[var(--ink-1)] text-[var(--chalk-3)] border-[var(--ink-4)]",
    label: row.resolvedOpen ? "Auto · open" : "Auto · closed",
    data: "auto",
  };
}

export function SquadMatchDayWindowControls({
  rows,
  setAction,
  clearAction,
}: Props) {
  const [modal, setModal] = useState<ModalState>(null);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (pending) return;
    setModal(null);
    setNote("");
    setError(null);
  }

  function confirm() {
    if (!modal) return;
    setError(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("matchDayId", modal.matchDayId);
        if (modal.kind === "open") {
          fd.set("state", "force_open");
          if (note) fd.set("note", note);
          await setAction(fd);
        } else if (modal.kind === "close") {
          fd.set("state", "force_close");
          if (note) fd.set("note", note);
          await setAction(fd);
        } else {
          await clearAction(fd);
        }
        setModal(null);
        setNote("");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Action failed";
        if (msg.toLowerCase().includes("next_redirect")) return;
        setError(msg);
      }
    });
  }

  return (
    <section
      aria-label="Squad submission per-match-day window"
      className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4"
      data-testid={TESTID.root}
    >
      <div className="mb-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--chalk-3)]">
          Per-match-day window
        </div>
        <p className="mt-1 text-xs text-[var(--chalk-2)]">
          Force open or close squad submissions for a specific match day.
          Takes precedence over the weekly window above. Clearing reverts
          to the weekly fallback.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-[var(--chalk-3)]">
          No match days scheduled yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--ink-4)] text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                <th className="py-2 pr-3">Match day</th>
                <th className="py-2 pr-3">Venue</th>
                <th className="py-2 pr-3">Window</th>
                <th className="py-2 pr-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const pill = statePill(row);
                return (
                  <tr
                    key={row.id}
                    className="border-b border-[var(--ink-3)] last:border-0"
                    data-testid={TESTID.row(row.id)}
                  >
                    <td className="py-2 pr-3 font-mono tabular text-[var(--chalk-0)]">
                      <div className="font-display font-semibold">
                        {row.matchDate}
                      </div>
                      <div className="text-[10px] text-[var(--chalk-3)]">
                        {row.matchCount} match
                        {row.matchCount === 1 ? "" : "es"} · {row.status}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-[var(--chalk-1)]">
                      {row.venueName}
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${pill.tone}`}
                        data-testid={TESTID.state(row.id)}
                        data-state={pill.data}
                      >
                        {pill.label}
                      </span>
                      {row.override?.note ? (
                        <div className="mt-1 max-w-[260px] truncate text-[10px] text-[var(--chalk-3)]">
                          {row.override.note}
                        </div>
                      ) : null}
                      {row.override ? (
                        <div className="mt-0.5 font-mono text-[9px] text-[var(--chalk-3)]">
                          since{" "}
                          {formatWat(row.override.setAt, "yyyy-MM-dd HH:mm")}{" "}
                          WAT
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setModal({
                              matchDayId: row.id,
                              matchDate: row.matchDate,
                              venueName: row.venueName,
                              kind: "open",
                            })
                          }
                          disabled={
                            row.override?.state === "force_open" || pending
                          }
                          data-testid={TESTID.openBtn(row.id)}
                          className="inline-flex items-center justify-center rounded-sm border border-[rgba(107,205,6,0.45)] bg-[rgba(107,205,6,0.08)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--signal)] transition-colors hover:bg-[rgba(107,205,6,0.16)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setModal({
                              matchDayId: row.id,
                              matchDate: row.matchDate,
                              venueName: row.venueName,
                              kind: "close",
                            })
                          }
                          disabled={
                            row.override?.state === "force_close" || pending
                          }
                          data-testid={TESTID.closeBtn(row.id)}
                          className="inline-flex items-center justify-center rounded-sm border border-[rgba(254,3,109,0.45)] bg-[rgba(254,3,109,0.08)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--secondary)] transition-colors hover:bg-[rgba(254,3,109,0.16)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Close
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setModal({
                              matchDayId: row.id,
                              matchDate: row.matchDate,
                              venueName: row.venueName,
                              kind: "clear",
                            })
                          }
                          disabled={!row.override || pending}
                          data-testid={TESTID.clearBtn(row.id)}
                          className="inline-flex items-center justify-center rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--chalk-1)] transition-colors hover:border-[var(--chalk-1)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Clear
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="squad-match-day-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
        >
          <div
            className="w-full max-w-md rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5 shadow-2xl"
            data-testid={TESTID.modal}
            data-kind={modal.kind}
          >
            <h3
              id="squad-match-day-modal-title"
              className="mb-3 font-display text-lg font-semibold text-[var(--chalk-0)]"
            >
              {modal.kind === "open"
                ? `Force OPEN submissions for ${modal.matchDate}?`
                : modal.kind === "close"
                  ? `Force CLOSE submissions for ${modal.matchDate}?`
                  : `Clear override for ${modal.matchDate}?`}
            </h3>

            <p className="mb-3 text-xs text-[var(--chalk-2)]">
              {modal.kind === "open"
                ? `Players will be able to submit a squad targeted at the ${modal.matchDate} (${modal.venueName}) match day. Submissions are tagged with this match day for the admin queue. Player-level bans + Friday change windows still apply.`
                : modal.kind === "close"
                  ? `Squad submissions for ${modal.matchDate} (${modal.venueName}) freeze immediately. The weekly fallback no longer applies for this match day.`
                  : `Reverts the ${modal.matchDate} match day to the weekly fallback (admin weekly override + the default Thursday 10:00 WAT deadline).`}
            </p>

            {modal.kind !== "clear" ? (
              <label className="mb-3 block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                  Note (optional)
                </span>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={200}
                  placeholder={
                    modal.kind === "open"
                      ? "e.g. make-up day after power outage"
                      : "e.g. event cancelled — squads voided"
                  }
                  className="w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-2 text-xs text-[var(--chalk-0)] focus:border-[var(--signal)] focus:outline-none"
                  data-testid={TESTID.note}
                />
              </label>
            ) : null}

            {error ? (
              <p
                className="mb-3 rounded-sm border border-[rgba(255,91,59,0.45)] bg-[rgba(255,91,59,0.08)] p-2 text-xs text-[var(--flare)]"
                data-testid={TESTID.error}
              >
                {error}
              </p>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={close}
                disabled={pending}
                data-testid={TESTID.cancel}
                className="inline-flex items-center justify-center gap-2 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-1)] transition-colors hover:border-[var(--chalk-1)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={pending}
                data-testid={TESTID.confirm}
                className={`inline-flex items-center justify-center gap-2 rounded-sm px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  modal.kind === "close"
                    ? "border border-[var(--secondary)] bg-[var(--secondary)] text-white hover:bg-[#d30259]"
                    : "border border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-ink)] hover:bg-[#82e21a]"
                }`}
              >
                {pending
                  ? "Working…"
                  : modal.kind === "open"
                    ? "Force open"
                    : modal.kind === "close"
                      ? "Force close"
                      : "Clear override"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
