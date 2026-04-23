"use client";

import { useState, useTransition } from "react";
import { formatWat } from "@/lib/time";
import type { SquadWindowOverride } from "@/server/squads/window_override";

/**
 * Admin dashboard control for the weekly squad-submission window.
 *
 * Three actions (each behind its own confirm modal):
 *   - Force open     — players can submit even past the Thursday deadline.
 *   - Force close    — freezes submissions this week.
 *   - Clear override — reverts to the time-based default.
 *
 * Server actions are passed in as props so this file can stay purely
 * client-side. Post-action the calling page auto-refreshes via
 * revalidatePath("/admin") from the action.
 */

type ActionFn = (note?: string) => Promise<void>;

type Props = {
  weekStart: string; // yyyy-MM-dd (Thursday week anchor)
  override: SquadWindowOverride | null;
  forceOpen: ActionFn;
  forceClose: ActionFn;
  clearOverride: ActionFn;
};

type ModalKind = "open" | "close" | "clear" | null;

const TESTID = {
  root: "squad-window-controls",
  openBtn: "squad-window-open-btn",
  closeBtn: "squad-window-close-btn",
  clearBtn: "squad-window-clear-btn",
  modal: "squad-window-modal",
  confirm: "squad-window-confirm-btn",
  cancel: "squad-window-cancel-btn",
  error: "squad-window-error",
  note: "squad-window-note",
};

export function SquadWindowControls({
  weekStart,
  override,
  forceOpen,
  forceClose,
  clearOverride,
}: Props) {
  const [modal, setModal] = useState<ModalKind>(null);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const currentState: "auto" | "force_open" | "force_close" = override?.state ?? "auto";

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
        if (modal === "open") await forceOpen(note || undefined);
        else if (modal === "close") await forceClose(note || undefined);
        else if (modal === "clear") await clearOverride();
        setModal(null);
        setNote("");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Action failed";
        if (msg.toLowerCase().includes("next_redirect")) return;
        setError(msg);
      }
    });
  }

  const pillTone =
    currentState === "force_open"
      ? "bg-[rgba(107,205,6,0.12)] text-[var(--signal)] border-[rgba(107,205,6,0.45)]"
      : currentState === "force_close"
        ? "bg-[rgba(254,3,109,0.12)] text-[var(--secondary)] border-[rgba(254,3,109,0.45)]"
        : "bg-[var(--ink-1)] text-[var(--chalk-2)] border-[var(--ink-4)]";

  const pillLabel =
    currentState === "force_open"
      ? "Force OPEN"
      : currentState === "force_close"
        ? "Force CLOSED"
        : "Auto (time-based)";

  return (
    <section
      aria-label="Squad submission window"
      className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4"
      data-testid={TESTID.root}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--chalk-3)]">
            Squad window · week of {weekStart}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] ${pillTone}`}
              data-testid="squad-window-state"
              data-state={currentState}
            >
              {pillLabel}
            </span>
            {override ? (
              <span className="font-mono text-[11px] text-[var(--chalk-3)]">
                since {formatWat(override.setAt, "yyyy-MM-dd HH:mm")} WAT
              </span>
            ) : null}
          </div>
          {override?.note ? (
            <p className="mt-2 text-xs text-[var(--chalk-2)]">
              Note: {override.note}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setModal("open")}
            disabled={currentState === "force_open" || pending}
            data-testid={TESTID.openBtn}
            className="inline-flex items-center justify-center gap-2 rounded-sm border border-[rgba(107,205,6,0.45)] bg-[rgba(107,205,6,0.08)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--signal)] transition-colors hover:bg-[rgba(107,205,6,0.16)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Open window
          </button>
          <button
            type="button"
            onClick={() => setModal("close")}
            disabled={currentState === "force_close" || pending}
            data-testid={TESTID.closeBtn}
            className="inline-flex items-center justify-center gap-2 rounded-sm border border-[rgba(254,3,109,0.45)] bg-[rgba(254,3,109,0.08)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--secondary)] transition-colors hover:bg-[rgba(254,3,109,0.16)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Close window
          </button>
          <button
            type="button"
            onClick={() => setModal("clear")}
            disabled={currentState === "auto" || pending}
            data-testid={TESTID.clearBtn}
            className="inline-flex items-center justify-center gap-2 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-1)] transition-colors hover:border-[var(--chalk-1)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Clear override
          </button>
        </div>
      </div>

      {modal ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="squad-window-modal-title"
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
            data-kind={modal}
          >
            <h3
              id="squad-window-modal-title"
              className="mb-3 font-display text-lg font-semibold text-[var(--chalk-0)]"
            >
              {modal === "open"
                ? "Force squad window OPEN?"
                : modal === "close"
                  ? "Force squad window CLOSED?"
                  : "Revert to auto (time-based)?"}
            </h3>

            <p className="mb-3 text-xs text-[var(--chalk-2)]">
              {modal === "open"
                ? "Players will be able to submit + change squads for this week even after the Thursday 10:00 WAT deadline. Auto-warnings for missed deadline will NOT fire while the window is forced open."
                : modal === "close"
                  ? "All squad submission + change flows freeze immediately for this week. Existing approved submissions remain valid but players cannot submit new ones."
                  : "Reverts to the default Thursday 10:00 WAT deadline + Friday 21:00-22:00 WAT change window. Future squads will follow the time-based rules."}
            </p>

            {modal !== "clear" ? (
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
                    modal === "open"
                      ? "e.g. late FC26 patch release"
                      : "e.g. emergency freeze — dispute pending"
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
                  modal === "close"
                    ? "border border-[var(--secondary)] bg-[var(--secondary)] text-white hover:bg-[#d30259]"
                    : "border border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-ink)] hover:bg-[#82e21a]"
                }`}
              >
                {pending
                  ? "Working…"
                  : modal === "open"
                    ? "Force open"
                    : modal === "close"
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
