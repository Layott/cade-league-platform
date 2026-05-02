"use client";

import { useMemo, useState, useTransition } from "react";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import type { ApplySquadResult } from "@/app/player/squad/actions";

/**
 * 2026-05-01 — bug 5. After a player submits (or while viewing a pending
 * submission), this disclosure lets them clone the same XI to other
 * upcoming match days they have NOT yet finalised. The default state is
 * COLLAPSED so the player has to opt in (no accidental mass-submit when
 * they meant to file just one match day).
 *
 * Eligible target match days are pre-computed server-side: only rows
 * whose window is open (per `resolveSquadWindowForMatchDay`) AND whose
 * existing submission is missing or pending. Approved / rejected MDs do
 * not appear at all.
 *
 * The action returns `{applied[], skipped[]}` and the component renders a
 * summary modal showing both lists. Skipped reasons surface verbatim so
 * the player can see why a target was passed over (e.g. "closed:..." or
 * "already_approved").
 */

export type ApplySquadEligibleMatchDay = {
  matchDayId: string;
  matchDate: string; // YYYY-MM-DD
  venueName: string;
  /** Status hint surfaced to the player (e.g. "open", "pending") so the
   *  checklist row is self-explanatory. NOT load-bearing: the server
   *  re-checks state at apply-time. */
  state: "open_no_submission" | "pending_resubmit";
};

export type ApplySquadToOtherMDsProps = {
  sourceMatchDayId: string;
  sourceMatchDate: string;
  eligible: ApplySquadEligibleMatchDay[];
  applyAction: (input: {
    sourceMatchDayId: string;
    targetMatchDayIds: string[];
  }) => Promise<ApplySquadResult>;
};

export function ApplySquadToOtherMDs({
  sourceMatchDayId,
  sourceMatchDate,
  eligible,
  applyAction,
}: ApplySquadToOtherMDsProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(eligible.map((e) => e.matchDayId)),
  );
  const [result, setResult] = useState<ApplySquadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const allChecked = useMemo(
    () => eligible.length > 0 && selected.size === eligible.length,
    [eligible, selected],
  );

  if (eligible.length === 0) {
    // Hide the whole disclosure when there's nothing to apply to. The
    // page still mounts the component so a future change to the eligible
    // set re-renders without a code path swap.
    return null;
  }

  function toggle(matchDayId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(matchDayId)) next.delete(matchDayId);
      else next.add(matchDayId);
      return next;
    });
  }

  function toggleAll() {
    if (allChecked) {
      setSelected(new Set());
    } else {
      setSelected(new Set(eligible.map((e) => e.matchDayId)));
    }
  }

  function onApply() {
    if (selected.size === 0) {
      setError("Pick at least one match day to apply your squad to.");
      return;
    }
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const res = await applyAction({
          sourceMatchDayId,
          targetMatchDayIds: Array.from(selected),
        });
        setResult(res);
      } catch (e) {
        setError((e as Error).message ?? "apply failed");
      }
    });
  }

  return (
    <section
      data-testid="apply-squad-to-other-mds"
      className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="apply-squad-toggle"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div>
          <div className="font-display text-sm font-semibold text-[var(--chalk-0)]">
            Apply this squad to other match days
          </div>
          <div className="mt-1 text-[11px] text-[var(--chalk-2)]">
            Clone your {sourceMatchDate} picks across {eligible.length}{" "}
            upcoming match {eligible.length === 1 ? "day" : "days"} that are
            still open.
          </div>
        </div>
        <span className="text-xs uppercase tracking-[0.2em] text-[var(--chalk-3)]">
          {open ? "Hide" : "Show"}
        </span>
      </button>

      {open ? (
        <div className="mt-4 flex flex-col gap-3" data-testid="apply-squad-panel">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--chalk-2)]">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={toggleAll}
                data-testid="apply-squad-toggle-all"
              />
              Select all
            </label>
            <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              {selected.size} / {eligible.length} selected
            </span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {eligible.map((md) => {
              const checked = selected.has(md.matchDayId);
              const note =
                md.state === "pending_resubmit"
                  ? "(replaces pending submission)"
                  : "(no submission yet)";
              return (
                <li
                  key={md.matchDayId}
                  className="flex items-center justify-between gap-3 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-2"
                >
                  <label className="flex flex-1 items-center gap-3 text-xs">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(md.matchDayId)}
                      data-testid={`apply-squad-cb-${md.matchDayId}`}
                    />
                    <span className="font-mono text-[var(--chalk-0)]">
                      {md.matchDate}
                    </span>
                    <span className="text-[var(--chalk-2)]">
                      {md.venueName}
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--chalk-3)]">
                      {note}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          {error ? (
            <div
              data-testid="apply-squad-error"
              className="rounded-sm border border-[var(--flare)] bg-[rgba(255,91,59,0.08)] p-2 text-xs text-[var(--flare)]"
            >
              {error}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <PrimaryButton
              type="button"
              onClick={onApply}
              disabled={isPending || selected.size === 0}
              data-testid="apply-squad-submit-btn"
            >
              {isPending
                ? "Applying…"
                : `Apply to ${selected.size} match ${selected.size === 1 ? "day" : "days"}`}
            </PrimaryButton>
            <SecondaryButton
              type="button"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </SecondaryButton>
          </div>

          {result ? (
            <div
              data-testid="apply-squad-result"
              className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] p-3 text-xs text-[var(--chalk-1)]"
            >
              <div className="font-semibold uppercase tracking-[0.18em] text-[var(--primary)]">
                Apply summary
              </div>
              <div className="mt-2">
                Applied:{" "}
                <span data-testid="apply-squad-applied-count">
                  {result.applied.length}
                </span>{" "}
                · Skipped:{" "}
                <span data-testid="apply-squad-skipped-count">
                  {result.skipped.length}
                </span>
              </div>
              {result.skipped.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {result.skipped.map((s) => {
                    const md = eligible.find((e) => e.matchDayId === s.matchDayId);
                    return (
                      <li
                        key={s.matchDayId}
                        className="text-[var(--chalk-2)]"
                        data-testid={`apply-squad-skipped-${s.matchDayId}`}
                      >
                        <span className="font-mono">
                          {md?.matchDate ?? s.matchDayId}
                        </span>{" "}
                        — {s.reason}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
