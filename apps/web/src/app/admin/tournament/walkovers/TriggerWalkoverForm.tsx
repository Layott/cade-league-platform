"use client";

import { useMemo, useState, useTransition } from "react";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import { triggerWalkoverAction } from "./actions";

/**
 * Plan 51 — admin-initiated walkover trigger.
 *
 * Pick a fixture (every fixture in the active season is listed; a status
 * tag flags whether a result already exists), pick the winner, and a
 * confirm-modal validates intent before writing the 3-0 row. Modal closes
 * after server returns ok; on error it surfaces inline.
 *
 * Bugfix 2026-04-26: previously the candidate list was filtered to
 * fixtures with NO existing result. That hid today's matchups whenever
 * scores had already been entered (e.g. via results-entry). The list now
 * includes every fixture; the server still rejects walkover writes when
 * a result already exists, so the operator sees a clear error rather
 * than the fixture silently disappearing.
 */

export type TriggerCandidate = {
  matchId: string;
  matchDayLabel: string;
  scheduledTime: string | null;
  homeId: string;
  homeName: string;
  awayId: string;
  awayName: string;
  status: "open" | "walkover_pending" | "has_result";
};

const STATUS_LABEL: Record<TriggerCandidate["status"], string> = {
  open: "",
  walkover_pending: " (walkover pending)",
  has_result: " (has result)",
};

export function TriggerWalkoverForm({
  candidates,
}: {
  candidates: TriggerCandidate[];
}) {
  // Default selection: first OPEN fixture; fall back to first overall.
  const defaultMatch =
    candidates.find((c) => c.status === "open") ?? candidates[0] ?? null;
  const [matchId, setMatchId] = useState<string>(
    defaultMatch?.matchId ?? "",
  );
  const [winnerId, setWinnerId] = useState<string>(
    defaultMatch?.homeId ?? "",
  );
  const [showModal, setShowModal] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedMatchId, setSavedMatchId] = useState<string | null>(null);

  const active = useMemo(
    () => candidates.find((c) => c.matchId === matchId) ?? null,
    [candidates, matchId],
  );

  // Reset winner if the fixture changes.
  function changeMatch(id: string) {
    setMatchId(id);
    const c = candidates.find((m) => m.matchId === id);
    if (c) setWinnerId(c.homeId);
  }

  function open() {
    setError(null);
    if (!active) {
      setError("Pick a fixture first");
      return;
    }
    if (winnerId !== active.homeId && winnerId !== active.awayId) {
      setError("Winner must be a participant of the fixture");
      return;
    }
    if (active.status === "has_result") {
      setError(
        "This fixture already has a result. Undo it first via the Adjustments tab, or use Results Entry > Forfeit option to overwrite.",
      );
      return;
    }
    setShowModal(true);
  }

  function confirm() {
    if (!active) return;
    setError(null);
    start(async () => {
      const out = await triggerWalkoverAction({
        matchId: active.matchId,
        winnerPlayerId: winnerId,
      });
      if (!out.ok) {
        setError(out.error ?? "Trigger failed");
        setShowModal(false);
        return;
      }
      setSavedMatchId(active.matchId);
      setShowModal(false);
    });
  }

  if (candidates.length === 0) {
    return (
      <div className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)]/40 p-6 text-center text-[12px] text-[var(--chalk-3)]">
        No fixtures scheduled in the active season.
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Fixture
          </span>
          <select
            value={matchId}
            onChange={(e) => changeMatch(e.target.value)}
            data-testid="trigger-walkover-match"
            className="w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-2 text-[13px] text-[var(--chalk-0)]"
          >
            {candidates.map((c) => {
              const time = c.scheduledTime ? `${c.scheduledTime} · ` : "";
              return (
                <option key={c.matchId} value={c.matchId}>
                  {c.matchDayLabel} · {time}
                  {c.homeName} vs {c.awayName}
                  {STATUS_LABEL[c.status]}
                </option>
              );
            })}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Winner
          </span>
          <select
            value={winnerId}
            onChange={(e) => setWinnerId(e.target.value)}
            data-testid="trigger-walkover-winner"
            className="w-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-2 text-[13px] text-[var(--chalk-0)]"
          >
            {active ? (
              <>
                <option value={active.homeId}>{active.homeName}</option>
                <option value={active.awayId}>{active.awayName}</option>
              </>
            ) : (
              <option value="">—</option>
            )}
          </select>
        </label>
      </div>

      {active?.status === "has_result" ? (
        <div className="rounded-sm border border-[rgba(255,91,59,0.3)] bg-[rgba(255,91,59,0.08)] p-2 text-[11px] text-[var(--flare)]">
          Fixture already has a recorded result. Trigger will fail — undo
          the existing result first (Adjustments tab) or use Results Entry
          forfeit to overwrite.
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <PrimaryButton type="button" onClick={open} disabled={pending}>
          Trigger walkover
        </PrimaryButton>
        {error ? (
          <span role="alert" className="text-[11px] text-[var(--flare)]" data-testid="trigger-walkover-error">
            {error}
          </span>
        ) : null}
        {savedMatchId ? (
          <span className="text-[11px] text-[var(--primary)]">
            Walkover written · standings recomputing
          </span>
        ) : null}
      </div>

      {showModal && active ? (
        <ConfirmModal
          home={active.homeName}
          away={active.awayName}
          winnerName={winnerId === active.homeId ? active.homeName : active.awayName}
          onCancel={() => setShowModal(false)}
          onConfirm={confirm}
          pending={pending}
        />
      ) : null}
    </div>
  );
}

function ConfirmModal({
  home,
  away,
  winnerName,
  onCancel,
  onConfirm,
  pending,
}: {
  home: string;
  away: string;
  winnerName: string;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="trigger-walkover-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div className="w-full max-w-md space-y-3 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] p-5 shadow-xl">
        <h2 className="font-display text-base font-semibold text-[var(--chalk-0)]">
          Confirm walkover
        </h2>
        <p className="text-[12px] text-[var(--chalk-2)]">
          About to award <span className="text-[var(--primary)]">{winnerName}</span>{" "}
          a 3-0 walkover in <strong>{home}</strong> vs <strong>{away}</strong>.
          This writes a final match_result row and recomputes standings.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <SecondaryButton type="button" onClick={onCancel} disabled={pending}>
            Cancel
          </SecondaryButton>
          <PrimaryButton
            type="button"
            onClick={onConfirm}
            disabled={pending}
            data-testid="trigger-walkover-confirm"
          >
            {pending ? "Writing..." : "Confirm"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
