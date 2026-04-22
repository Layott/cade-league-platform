"use client";

import { useState, useTransition } from "react";
import type { SquadItemReview } from "@/server/squads";
import { selectClass } from "@/components/admin/FormField";
import { PrimaryButton } from "@/components/admin/buttons";

/**
 * Plan 23 — per-row FCDB validation chip rendered inline with each
 * squad_player_items row on /admin/squads/[id].
 *
 * States (Plan 23 §2.3):
 *   - resolved  → green ✓ FCDB        (informational; click reveals candidate)
 *   - ambiguous → amber ⚠ pick        (click opens dropdown; ref locks in)
 *   - fuzzy     → blue  ≈ fuzzy       (click reveals top match + similarity)
 *   - unknown   → grey  ? unknown     (click reveals "no FCDB match" copy)
 *
 * Bundle: pure Tailwind classes + native <details>; no external deps.
 * Verified ≤ 5 KB gzipped per Plan 23 spec target.
 *
 * The pick form posts to a server action passed in via `onPickAction`. We
 * intentionally do NOT collapse the form on success — the page server
 * component re-renders after revalidatePath and the chip flips to
 * `resolved` automatically.
 */

export type FcdbBadgeProps = {
  review: SquadItemReview;
  onPickAction?: (formData: FormData) => Promise<void>;
};

const CHIP_CLASSES =
  "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] cursor-pointer select-none";

const STYLES: Record<SquadItemReview["status"], { chip: string; label: string }> = {
  resolved: {
    chip: "border-[rgba(107,205,6,0.45)] bg-[rgba(107,205,6,0.1)] text-[var(--primary)]",
    label: "✓ FCDB",
  },
  ambiguous: {
    chip: "border-[rgba(255,186,8,0.45)] bg-[rgba(255,186,8,0.12)] text-[#f5b800]",
    label: "⚠ pick",
  },
  fuzzy: {
    chip: "border-[rgba(80,160,255,0.45)] bg-[rgba(80,160,255,0.1)] text-[#7fb6ff]",
    label: "≈ fuzzy",
  },
  unknown: {
    chip: "border-[var(--ink-4)] bg-[var(--ink-3)] text-[var(--chalk-3)]",
    label: "? unknown",
  },
};

function CandidateLine({
  c,
  badge,
}: {
  c: NonNullable<SquadItemReview["candidate"]>;
  badge?: string;
}) {
  return (
    <div className="text-[11px] text-[var(--chalk-2)]">
      <span className="font-medium text-[var(--chalk-1)]">{c.name}</span>
      <span className="ml-2 font-mono">{c.rating}</span>
      <span className="ml-2 text-[var(--chalk-3)]">{c.position}</span>
      {c.club ? (
        <span className="ml-2 text-[var(--chalk-3)]">· {c.club}</span>
      ) : null}
      {c.value_coins_estimate != null ? (
        <span className="ml-2 font-mono text-[var(--chalk-3)]">
          {c.value_coins_estimate.toLocaleString()}c
        </span>
      ) : null}
      {badge ? (
        <span className="ml-2 rounded-sm bg-[var(--ink-3)] px-1 py-0.5 font-mono text-[9px] text-[var(--chalk-3)]">
          {badge}
        </span>
      ) : null}
    </div>
  );
}

export function FcdbBadge({ review, onPickAction }: FcdbBadgeProps) {
  const style = STYLES[review.status];
  const [isPending, startTransition] = useTransition();
  const [pickedId, setPickedId] = useState<string>("");

  return (
    <details
      className="group relative"
      data-testid={`fcdb-badge-${review.itemId}`}
      data-status={review.status}
    >
      <summary
        className={`${CHIP_CLASSES} ${style.chip} list-none [&::-webkit-details-marker]:hidden`}
      >
        {style.label}
      </summary>

      <div className="absolute right-0 z-10 mt-1 w-72 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-2 shadow-lg">
        {review.status === "resolved" && review.candidate ? (
          <CandidateLine c={review.candidate} />
        ) : null}

        {review.status === "fuzzy" ? (
          <>
            {review.candidate ? (
              <CandidateLine
                c={review.candidate}
                badge={
                  typeof review.similarity === "number"
                    ? `sim ${Math.round(review.similarity * 100)}%`
                    : undefined
                }
              />
            ) : (
              <div className="text-[11px] text-[var(--chalk-3)]">no top match</div>
            )}
            <p className="mt-1 text-[10px] text-[var(--chalk-3)]">
              Trigram fallback — confirm or dismiss.
            </p>
          </>
        ) : null}

        {review.status === "ambiguous" ? (
          <>
            <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              Pick the right item
            </p>
            <ul className="mb-2 max-h-40 space-y-1 overflow-auto">
              {review.candidate ? (
                <li>
                  <CandidateLine c={review.candidate} />
                </li>
              ) : null}
              {(review.alternatives ?? []).map((c) => (
                <li key={c.id}>
                  <CandidateLine c={c} />
                </li>
              ))}
            </ul>
            {onPickAction ? (
              <form
                action={(formData) => {
                  startTransition(() => onPickAction(formData));
                }}
                className="flex items-center gap-1"
              >
                <input type="hidden" name="itemId" value={review.itemId} />
                <select
                  name="fcPlayerId"
                  value={pickedId}
                  onChange={(e) => setPickedId(e.target.value)}
                  required
                  className={selectClass + " flex-1 px-2 py-1 text-[11px]"}
                  data-testid={`fcdb-pick-select-${review.itemId}`}
                >
                  <option value="">— select —</option>
                  {review.candidate ? (
                    <option value={review.candidate.id}>
                      {review.candidate.name} · {review.candidate.rating}
                    </option>
                  ) : null}
                  {(review.alternatives ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.rating}
                      {c.club ? ` · ${c.club}` : ""}
                    </option>
                  ))}
                </select>
                <PrimaryButton
                  type="submit"
                  size="sm"
                  disabled={isPending || !pickedId}
                  data-testid={`fcdb-pick-submit-${review.itemId}`}
                >
                  {isPending ? "…" : "Lock"}
                </PrimaryButton>
              </form>
            ) : null}
          </>
        ) : null}

        {review.status === "unknown" ? (
          <p className="text-[11px] text-[var(--chalk-3)]">
            {review.reason ?? "no FCDB match — possible typo or unreleased item"}
          </p>
        ) : null}
      </div>
    </details>
  );
}

export type FcdbSummaryProps = {
  summary: {
    total: number;
    resolved: number;
    fuzzy: number;
    ambiguous: number;
    unknown: number;
    fcdbEmpty: boolean;
  };
};

/**
 * Compact header chip: "FCDB: 8 resolved · 2 fuzzy · 1 unknown".
 * Hidden when FCDB is empty (the empty-banner above the table covers it).
 */
export function FcdbSummaryChip({ summary }: FcdbSummaryProps) {
  if (summary.fcdbEmpty) return null;
  const parts: string[] = [];
  if (summary.resolved > 0) parts.push(`${summary.resolved} resolved`);
  if (summary.ambiguous > 0) parts.push(`${summary.ambiguous} pick`);
  if (summary.fuzzy > 0) parts.push(`${summary.fuzzy} fuzzy`);
  if (summary.unknown > 0) parts.push(`${summary.unknown} unknown`);
  const label = parts.length > 0 ? parts.join(" · ") : "no items";
  return (
    <span
      data-testid="fcdb-summary-chip"
      className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--chalk-2)]"
    >
      FCDB: {label}
    </span>
  );
}
