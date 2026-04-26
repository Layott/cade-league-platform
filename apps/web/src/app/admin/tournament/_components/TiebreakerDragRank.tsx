"use client";

import { useState, useTransition } from "react";
import { PrimaryButton, SecondaryButton } from "@/components/admin/buttons";

/**
 * Plan 51 — drag-rank UI for `seasons.tiebreaker_order`.
 *
 * Native HTML5 drag-and-drop (no @dnd-kit) keeps the page bundle slim — we
 * own a single ordered list, so the lift-and-drop affordances of dnd-kit
 * are overkill. Keyboard fallback: ↑/↓ buttons next to each row.
 *
 * Save POSTs the new order to /api/tournament/tiebreakers; Reset wipes
 * back to the canonical `["totalPts","gd","gf"]` ladder. The engine still
 * anchors with alphabetical name as the deterministic final fallback —
 * that's automatic, not something the operator configures here.
 *
 * Bugfix 2026-04-26: removed `name` from the user-facing ladder per
 * user spec. Added `ga` (Goals Against, lower-better). Legacy seasons
 * with `name` saved in `tiebreaker_order` JSONB are migrated on load
 * (filtered out on display) so the operator never sees a `name` row.
 */

const KEY_LABELS: Record<string, { label: string; hint: string }> = {
  totalPts: { label: "Total Points", hint: "League points (3 win / 1 draw)." },
  gd: { label: "Goal Difference", hint: "Goals For minus Goals Against." },
  gf: { label: "Goals For", hint: "Total goals scored across the season." },
  ga: { label: "Goals Against", hint: "Total goals conceded (lower better)." },
  wins: { label: "Wins", hint: "Total match wins." },
  losses: { label: "Losses", hint: "Total match losses (lower better)." },
  played: { label: "Played", hint: "Total matches played." },
};

export const DEFAULT_ORDER = ["totalPts", "gd", "gf"];
export const ALL_KEYS = ["totalPts", "gd", "gf", "ga", "wins", "losses", "played"];

export function TiebreakerDragRank({
  initialOrder,
  saveAction,
}: {
  initialOrder: string[];
  saveAction: (order: string[]) => Promise<{ ok: boolean; error?: string }>;
}) {
  // Filter legacy `name` entries out of the displayed order (engine
  // still anchors with `name` automatically). If the filter empties
  // the list, fall back to DEFAULT_ORDER so the UI is never blank.
  const sanitizedInitial = initialOrder.filter((k) => k !== "name");
  const [order, setOrder] = useState<string[]>(
    sanitizedInitial.length > 0 ? sanitizedInitial : DEFAULT_ORDER,
  );
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(order) !== JSON.stringify(sanitizedInitial);

  function handleDragStart(idx: number, e: React.DragEvent) {
    setDragIndex(idx);
    e.dataTransfer.effectAllowed = "move";
    // Setting plain-text dummy data keeps Firefox happy.
    try {
      e.dataTransfer.setData("text/plain", String(idx));
    } catch {
      /* ignore */
    }
  }

  function handleDragOver(idx: number, e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragIndex === null || dragIndex === idx) return;
  }

  function handleDrop(idx: number, e: React.DragEvent) {
    e.preventDefault();
    if (dragIndex === null) return;
    if (dragIndex === idx) {
      setDragIndex(null);
      return;
    }
    setOrder((cur) => moveItem(cur, dragIndex, idx));
    setDragIndex(null);
  }

  function move(idx: number, dir: -1 | 1) {
    setOrder((cur) => {
      const next = idx + dir;
      if (next < 0 || next >= cur.length) return cur;
      return moveItem(cur, idx, next);
    });
  }

  function addKey(key: string) {
    if (order.includes(key)) return;
    setOrder([...order, key]);
  }

  function removeKey(idx: number) {
    setOrder(order.filter((_, i) => i !== idx));
  }

  function reset() {
    setOrder(DEFAULT_ORDER);
  }

  function save() {
    setError(null);
    setSavedAt(null);
    start(async () => {
      const out = await saveAction(order);
      if (!out.ok) {
        setError(out.error ?? "Save failed");
        return;
      }
      setSavedAt(new Date().toISOString());
    });
  }

  const remainingKeys = ALL_KEYS.filter((k) => !order.includes(k));

  return (
    <div className="space-y-4" data-testid="tiebreaker-drag-rank">
      <ol className="space-y-2" data-testid="tiebreaker-list">
        {order.map((key, idx) => {
          const meta = KEY_LABELS[key] ?? { label: key, hint: "" };
          return (
            <li
              key={key}
              draggable
              onDragStart={(e) => handleDragStart(idx, e)}
              onDragOver={(e) => handleDragOver(idx, e)}
              onDrop={(e) => handleDrop(idx, e)}
              data-testid={`tiebreaker-row-${key}`}
              data-position={idx + 1}
              className={
                "flex cursor-move items-center gap-3 rounded-sm border bg-[var(--ink-2)] p-3 transition-colors " +
                (dragIndex === idx
                  ? "border-[var(--primary)] opacity-60"
                  : "border-[var(--ink-4)] hover:border-[var(--signal)]")
              }
            >
              <span className="font-mono text-[11px] tabular text-[var(--chalk-3)]">
                {String(idx + 1).padStart(2, "0")}
              </span>
              <div className="flex-1">
                <div className="font-display text-sm text-[var(--chalk-0)]">
                  {meta.label}
                </div>
                <div className="text-[11px] text-[var(--chalk-3)]">{meta.hint}</div>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => move(idx, -1)}
                  aria-label={`Move ${meta.label} up`}
                  disabled={idx === 0}
                  className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-3)] px-2 py-0.5 text-[10px] text-[var(--chalk-1)] hover:border-[var(--signal)] hover:text-[var(--signal)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(idx, 1)}
                  aria-label={`Move ${meta.label} down`}
                  disabled={idx === order.length - 1}
                  className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-3)] px-2 py-0.5 text-[10px] text-[var(--chalk-1)] hover:border-[var(--signal)] hover:text-[var(--signal)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => removeKey(idx)}
                  aria-label={`Remove ${meta.label}`}
                  disabled={order.length <= 1}
                  className="rounded-sm border border-[rgba(255,91,59,0.3)] bg-[rgba(255,91,59,0.08)] px-2 py-0.5 text-[10px] text-[var(--flare)] hover:border-[var(--flare)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ✕
                </button>
              </div>
            </li>
          );
        })}
      </ol>

      {remainingKeys.length > 0 ? (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Add tiebreaker
          </div>
          <div className="flex flex-wrap gap-1.5">
            {remainingKeys.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => addKey(k)}
                className="rounded-sm border border-dashed border-[var(--ink-4)] bg-transparent px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-2)] hover:border-[var(--signal)] hover:text-[var(--signal)]"
                data-testid={`tiebreaker-add-${k}`}
              >
                + {KEY_LABELS[k]?.label ?? k}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-2 border-t border-[var(--ink-4)] pt-4">
        <PrimaryButton
          type="button"
          disabled={!dirty || pending}
          onClick={save}
          data-testid="tiebreaker-save"
        >
          {pending ? "Saving..." : "Save order"}
        </PrimaryButton>
        <SecondaryButton type="button" onClick={reset} disabled={pending}>
          Reset to default
        </SecondaryButton>
        {savedAt ? (
          <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--primary)]">
            Saved
          </span>
        ) : null}
        {error ? (
          <span role="alert" className="text-[11px] text-[var(--flare)]">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const out = [...arr];
  const [m] = out.splice(from, 1);
  out.splice(to, 0, m);
  return out;
}
