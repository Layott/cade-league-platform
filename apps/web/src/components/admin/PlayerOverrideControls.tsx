"use client";

import { useState, useTransition } from "react";
import { formatWat } from "@/lib/time";
import type { PlayerSquadOverride } from "@/server/squads/player_override";

/**
 * Per-player squad-window override controls. Rendered on each row of the
 * admin squads list (and optionally on /admin/squads/[id]). Two actions
 * behind confirm modals:
 *   - Ban          — this player cannot submit/edit this week, even if
 *                    the league window is open.
 *   - Force-open   — this player CAN submit/edit even after the Thursday
 *                    10:00 WAT deadline, even if the league window is
 *                    closed.
 *   - Clear        — revert to league-default behaviour.
 *
 * Each row shows a compact pill with the current state; buttons are
 * tucked behind a small "..." trigger to keep the table quiet.
 */

type ActionFn = (playerId: string, note?: string) => Promise<void>;
type ClearFn = (playerId: string) => Promise<void>;

type Props = {
  playerId: string;
  playerLabel: string; // display name for the modal copy
  weekStart: string;
  override: PlayerSquadOverride | null;
  banPlayer: ActionFn;
  forceOpenPlayer: ActionFn;
  clearPlayerOverride: ClearFn;
};

type ModalKind = "ban" | "open" | "clear" | null;

export function PlayerOverrideControls({
  playerId,
  playerLabel,
  weekStart,
  override,
  banPlayer,
  forceOpenPlayer,
  clearPlayerOverride,
}: Props) {
  const [modal, setModal] = useState<ModalKind>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const currentState: "auto" | "ban" | "force_open" = override?.state ?? "auto";

  const pillTone =
    currentState === "ban"
      ? "bg-[rgba(254,3,109,0.14)] text-[var(--secondary)] border-[rgba(254,3,109,0.45)]"
      : currentState === "force_open"
        ? "bg-[rgba(107,205,6,0.12)] text-[var(--signal)] border-[rgba(107,205,6,0.45)]"
        : "bg-transparent text-[var(--chalk-3)] border-[var(--ink-4)]";
  const pillLabel =
    currentState === "ban"
      ? "Banned"
      : currentState === "force_open"
        ? "Force OPEN"
        : "Auto";

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
        if (modal === "ban") await banPlayer(playerId, note || undefined);
        else if (modal === "open") await forceOpenPlayer(playerId, note || undefined);
        else if (modal === "clear") await clearPlayerOverride(playerId);
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
    <>
      <div
        className="flex items-center gap-2"
        data-testid={`player-override-${playerId}`}
      >
        <span
          className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] ${pillTone}`}
          data-state={currentState}
          data-testid={`player-override-state-${playerId}`}
          title={
            override
              ? `${pillLabel} since ${formatWat(override.setAt, "yyyy-MM-dd HH:mm")} WAT${override.note ? " — " + override.note : ""}`
              : "Default time-based window"
          }
        >
          {pillLabel}
        </span>
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-1.5 py-0.5 text-[10px] text-[var(--chalk-2)] hover:border-[var(--signal)] hover:text-[var(--signal)]"
          data-testid={`player-override-menu-${playerId}`}
        >
          ⋯
        </button>
      </div>
      {menuOpen ? (
        <div
          className="absolute z-30 mt-1 flex flex-col gap-1 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-1 shadow-lg"
          onMouseLeave={() => setMenuOpen(false)}
          data-testid={`player-override-menu-open-${playerId}`}
        >
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setModal("ban");
            }}
            disabled={currentState === "ban"}
            className="rounded-sm px-2 py-1 text-left text-[11px] text-[var(--secondary)] hover:bg-[rgba(254,3,109,0.12)] disabled:opacity-40"
            data-testid={`player-override-ban-${playerId}`}
          >
            Ban this week
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setModal("open");
            }}
            disabled={currentState === "force_open"}
            className="rounded-sm px-2 py-1 text-left text-[11px] text-[var(--signal)] hover:bg-[rgba(107,205,6,0.12)] disabled:opacity-40"
            data-testid={`player-override-open-${playerId}`}
          >
            Force-open this week
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setModal("clear");
            }}
            disabled={currentState === "auto"}
            className="rounded-sm px-2 py-1 text-left text-[11px] text-[var(--chalk-1)] hover:bg-[var(--ink-3)] disabled:opacity-40"
            data-testid={`player-override-clear-${playerId}`}
          >
            Clear override
          </button>
        </div>
      ) : null}

      {modal ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="player-override-title"
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
            data-testid={`player-override-modal-${playerId}`}
            data-kind={modal}
          >
            <h3
              id="player-override-title"
              className="mb-3 font-display text-lg font-semibold text-[var(--chalk-0)]"
            >
              {modal === "ban"
                ? `Ban ${playerLabel} from submitting this week?`
                : modal === "open"
                  ? `Force-open submissions for ${playerLabel} this week?`
                  : `Clear override for ${playerLabel}?`}
            </h3>
            <p className="mb-3 text-xs text-[var(--chalk-2)]">
              {modal === "ban"
                ? `The player will not be able to submit or edit a squad for the week of ${weekStart}. Admins retain full control (approve/reject/reopen) on any existing submission.`
                : modal === "open"
                  ? `${playerLabel} will be able to submit/edit a squad for the week of ${weekStart} even after the Thursday 10:00 WAT deadline and even if the league window is closed.`
                  : `Reverts ${playerLabel} to the default time-based window + the league-wide setting for the week of ${weekStart}.`}
            </p>

            {modal !== "clear" ? (
              <label className="mb-3 block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                  Note (optional — shows in audit log)
                </span>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={200}
                  placeholder={
                    modal === "ban"
                      ? "e.g. under dispute; provisional ban"
                      : "e.g. internet outage; one-off extension"
                  }
                  className="w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-2 text-xs text-[var(--chalk-0)] focus:border-[var(--signal)] focus:outline-none"
                />
              </label>
            ) : null}

            {error ? (
              <p className="mb-3 rounded-sm border border-[rgba(255,91,59,0.45)] bg-[rgba(255,91,59,0.08)] p-2 text-xs text-[var(--flare)]">
                {error}
              </p>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className="inline-flex items-center justify-center gap-2 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-1)] transition-colors hover:border-[var(--chalk-1)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={pending}
                className={`inline-flex items-center justify-center gap-2 rounded-sm px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  modal === "ban"
                    ? "border border-[var(--secondary)] bg-[var(--secondary)] text-white hover:bg-[#d30259]"
                    : "border border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-ink)] hover:bg-[#82e21a]"
                }`}
              >
                {pending
                  ? "Working…"
                  : modal === "ban"
                    ? "Ban player"
                    : modal === "open"
                      ? "Force-open"
                      : "Clear"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
