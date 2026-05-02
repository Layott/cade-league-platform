"use client";

import { useState, useTransition } from "react";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";
import type { ApplySquadResult } from "@/app/player/squad/actions";

/**
 * 2026-05-02 — focused weekend continuation prompt.
 *
 * After a player submits a squad for ONE match day in a Sat+Sun weekend,
 * `/player/squad?submitted=<mdId>` renders this banner asking whether to
 * apply the same roster to the OTHER match day in the weekend (when the
 * sibling exists + has no submission yet + the window is still open).
 *
 * Differs from `<ApplySquadToOtherMDs>` (which is a collapsible multi-week
 * checklist) — this prompt is purely about the weekend pair. One click
 * applies, one click dismisses. Designed to surface ONCE per submit.
 *
 * Shown ABOVE the picker bucketed list. After Apply succeeds OR the
 * player dismisses it, the banner hides itself locally so a refresh on
 * the same URL still keeps it dismissed for that session.
 */
export type WeekendApplyPromptProps = {
  sourceMatchDayId: string;
  sourceMatchDate: string; // YYYY-MM-DD
  sourceDayLabel: string; // e.g. "Saturday May 2"
  siblingMatchDayId: string;
  siblingMatchDate: string; // YYYY-MM-DD
  siblingDayLabel: string; // e.g. "Sunday May 3"
  applyAction: (input: {
    sourceMatchDayId: string;
    targetMatchDayIds: string[];
  }) => Promise<ApplySquadResult>;
};

export function WeekendApplyPrompt({
  sourceMatchDayId,
  sourceDayLabel,
  siblingMatchDayId,
  siblingDayLabel,
  applyAction,
}: WeekendApplyPromptProps) {
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplySquadResult | null>(null);
  const [isPending, startTransition] = useTransition();

  if (dismissed) return null;

  function onApply() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const res = await applyAction({
          sourceMatchDayId,
          targetMatchDayIds: [siblingMatchDayId],
        });
        setResult(res);
        if (res.applied.length === 1 && res.skipped.length === 0) {
          // Clean apply — auto-collapse the banner after a beat so the
          // player sees the success message then it gets out of the way.
          setTimeout(() => setDismissed(true), 1500);
        }
      } catch (e) {
        setError((e as Error).message ?? "apply failed");
      }
    });
  }

  function onDismiss() {
    setDismissed(true);
  }

  return (
    <section
      data-testid="weekend-apply-prompt"
      className="rounded-sm border border-[rgba(107,205,6,0.45)] bg-[rgba(107,205,6,0.06)] p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="font-display text-sm font-semibold text-[var(--chalk-0)]">
            Squad submitted for {sourceDayLabel}
          </div>
          <div className="text-[12px] text-[var(--chalk-1)]">
            Use the same roster for{" "}
            <span className="font-semibold text-[var(--chalk-0)]">
              {siblingDayLabel}
            </span>
            ?
          </div>
        </div>
        {!result ? (
          <div className="flex flex-wrap gap-2">
            <PrimaryButton
              type="button"
              size="sm"
              onClick={onApply}
              disabled={isPending}
              data-testid="weekend-apply-prompt-apply-btn"
            >
              {isPending ? "Applying…" : `Apply to ${siblingDayLabel}`}
            </PrimaryButton>
            <SecondaryButton
              type="button"
              size="sm"
              onClick={onDismiss}
              disabled={isPending}
              data-testid="weekend-apply-prompt-dismiss-btn"
            >
              No, I&apos;ll pick separately
            </SecondaryButton>
          </div>
        ) : null}
      </div>

      {error ? (
        <div
          data-testid="weekend-apply-prompt-error"
          className="mt-3 rounded-sm border border-[var(--flare)] bg-[rgba(255,91,59,0.08)] p-2 text-xs text-[var(--flare)]"
        >
          {error}
        </div>
      ) : null}

      {result ? (
        <div
          data-testid="weekend-apply-prompt-result"
          className="mt-3 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] p-2 text-xs text-[var(--chalk-1)]"
        >
          {result.applied.length === 1 ? (
            <span data-testid="weekend-apply-prompt-applied">
              Applied to {siblingDayLabel}.
            </span>
          ) : (
            <span data-testid="weekend-apply-prompt-skipped">
              Could not apply: {result.skipped[0]?.reason ?? "unknown reason"}.
            </span>
          )}
        </div>
      ) : null}
    </section>
  );
}
