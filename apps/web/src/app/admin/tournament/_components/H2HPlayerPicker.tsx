"use client";

import { useMemo } from "react";

/**
 * Plan 51 — multi-select player picker for the H2H tab.
 *
 * Rendered as a row of toggle chips because the dataset is bounded to 13
 * players + we want one-tap selection. Enforces 2-5 selections; <2 shows
 * a hint, >5 disables further additions.
 */

export type PickerPlayer = {
  id: string;
  name: string;
  gamerTag: string;
};

export function H2HPlayerPicker({
  players,
  selected,
  onChange,
  min = 2,
  max = 5,
}: {
  players: PickerPlayer[];
  selected: string[];
  onChange: (next: string[]) => void;
  min?: number;
  max?: number;
}) {
  const sel = useMemo(() => new Set(selected), [selected]);

  function toggle(id: string) {
    if (sel.has(id)) {
      onChange(selected.filter((s) => s !== id));
      return;
    }
    if (selected.length >= max) return;
    onChange([...selected, id]);
  }

  const status =
    selected.length < min
      ? `Pick at least ${min} players`
      : selected.length >= max
        ? `Maximum ${max} reached`
        : `${selected.length} selected`;

  return (
    <div className="space-y-2" data-testid="h2h-player-picker">
      <div className="flex flex-wrap gap-1.5">
        {players.map((p) => {
          const active = sel.has(p.id);
          const atMax = !active && selected.length >= max;
          return (
            <button
              key={p.id}
              type="button"
              disabled={atMax}
              onClick={() => toggle(p.id)}
              data-testid={`h2h-pick-${p.gamerTag}`}
              data-selected={active ? "true" : "false"}
              className={
                "rounded-sm px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors " +
                (active
                  ? "bg-[var(--primary)] text-[var(--primary-ink)]"
                  : atMax
                    ? "border border-[var(--ink-4)] bg-[var(--ink-2)] text-[var(--chalk-3)] opacity-50"
                    : "border border-[var(--ink-4)] bg-[var(--ink-2)] text-[var(--chalk-2)] hover:border-[var(--signal)] hover:text-[var(--signal)]")
              }
            >
              {p.gamerTag || p.name}
            </button>
          );
        })}
      </div>
      <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--chalk-3)]" aria-live="polite">
        {status}
      </div>
    </div>
  );
}
