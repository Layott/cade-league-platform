"use client";

import { useState, useTransition } from "react";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";

/**
 * Plan 51 — single pending walkover row.
 *
 * The server action passed via `confirmAction` flips
 * `walkover_pending = false` + stamps `walkover_confirmed_at = now()`.
 * Optimistic UI: row hides itself immediately on success and the parent's
 * `onConfirmed` callback (if supplied) prunes the parent list.
 */

export function WalkoverConfirmCard({
  matchId,
  homeName,
  awayName,
  winnerName,
  matchDate,
  initiatedBy,
  confirmAction,
  onConfirmed,
}: {
  matchId: string;
  homeName: string;
  awayName: string;
  winnerName: string;
  matchDate: string | null;
  initiatedBy: "ref" | "admin" | null;
  confirmAction: (matchId: string) => Promise<{ ok: boolean; error?: string }>;
  onConfirmed?: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function onClick() {
    setError(null);
    start(async () => {
      const out = await confirmAction(matchId);
      if (!out.ok) {
        setError(out.error ?? "Confirm failed");
        return;
      }
      setDone(true);
      onConfirmed?.();
    });
  }

  if (done) return null;

  return (
    <div
      className="flex flex-col gap-3 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4 md:flex-row md:items-center md:justify-between"
      data-testid={`walkover-pending-${matchId}`}
    >
      <div className="flex flex-col gap-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          {matchDate ?? "Date TBD"} · Initiated by {initiatedBy ?? "ref"}
        </div>
        <div className="font-display text-sm text-[var(--chalk-0)]">
          {homeName} <span className="text-[var(--chalk-3)]">vs</span> {awayName}
        </div>
        <div className="text-[11px] text-[var(--chalk-2)]">
          Winner on confirm:{" "}
          <span className="font-semibold text-[var(--primary)]">{winnerName}</span>{" "}
          (3-0)
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <div className="flex gap-2">
          <SecondaryButton size="sm" disabled type="button">
            Reject (TBD)
          </SecondaryButton>
          <PrimaryButton
            size="sm"
            type="button"
            disabled={pending}
            onClick={onClick}
            data-testid={`walkover-confirm-${matchId}`}
          >
            {pending ? "Confirming..." : "Confirm"}
          </PrimaryButton>
        </div>
        {error ? (
          <div role="alert" className="text-[10px] text-[var(--flare)]">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
