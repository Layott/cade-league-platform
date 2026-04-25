"use client";

import {
  V2_PLAYER_SLUGS,
  V2_PLAYER_NAMES,
  type V2PlayerSlug,
} from "./players";

/**
 * Plan 51 — 13-player dropdown used by H2H pickers, score-bug, up-next.
 *
 * Native <select> for keyboard support. Mirrors the static mockup styling
 * defined in v2/index.html (`.edit-panel select`).
 */

export type PlayerSelectProps = {
  name: string;
  defaultValue?: V2PlayerSlug;
  value?: V2PlayerSlug | string;
  onChange?: (slug: V2PlayerSlug) => void;
  label?: string;
  testId?: string;
};

export function PlayerSelect({
  name,
  defaultValue,
  value,
  onChange,
  label,
  testId,
}: PlayerSelectProps) {
  return (
    <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--chalk-3)]">
      {label ? <span>{label}</span> : null}
      <select
        name={name}
        defaultValue={defaultValue}
        value={value}
        onChange={
          onChange
            ? (e) => onChange(e.target.value as V2PlayerSlug)
            : undefined
        }
        data-testid={testId ?? `v2-player-${name}`}
        className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-2 py-1.5 font-mono text-[12px] tracking-[0.06em] text-[var(--chalk-1)] focus:border-[var(--signal)] focus:outline-none"
      >
        {V2_PLAYER_SLUGS.map((slug) => (
          <option key={slug} value={slug}>
            {V2_PLAYER_NAMES[slug]}
          </option>
        ))}
      </select>
    </label>
  );
}
