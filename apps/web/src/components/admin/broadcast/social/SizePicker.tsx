"use client";

import { SIZE_PRESETS, type SocialSize } from "@/lib/social-sizes";

/**
 * Plan 54 Wave 2B — `<SizePicker>` renders one pill per supported size.
 *
 * Controlled component. The parent owns the selected size; this component
 * just renders + emits onChange. Disabled state for a size NOT in the
 * supported list (we still show it greyed out so admins know it exists).
 *
 * Spec: docs/superpowers/specs/2026-05-05-broadcast-social-media.md §6.
 */

const ALL_SIZES = Object.keys(SIZE_PRESETS) as ReadonlyArray<SocialSize>;

export function SizePicker({
  sizes,
  value,
  onChange,
  showAll = false,
}: {
  /** The set of sizes this template supports. */
  sizes: ReadonlyArray<SocialSize>;
  value: SocialSize;
  onChange: (s: SocialSize) => void;
  /**
   * When true, render every preset (greying out unsupported ones) so the
   * admin sees the full menu. Default false renders only supported.
   */
  showAll?: boolean;
}) {
  const supported = new Set<SocialSize>(sizes);
  const list = showAll ? ALL_SIZES : sizes;

  return (
    <div
      className="flex flex-wrap gap-2"
      role="radiogroup"
      aria-label="Render size"
      data-testid="size-picker"
    >
      {list.map((s) => {
        const preset = SIZE_PRESETS[s];
        const enabled = supported.has(s);
        const active = value === s;
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={!enabled}
            onClick={() => enabled && onChange(s)}
            data-testid={`size-pill-${s}`}
            data-active={active ? "true" : "false"}
            className={
              "inline-flex flex-col items-start gap-0.5 rounded-sm border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 " +
              (active
                ? "border-[var(--primary)] bg-[rgba(107,205,6,0.1)] text-[var(--chalk-0)]"
                : "border-[var(--ink-4)] bg-[var(--ink-2)] text-[var(--chalk-1)] hover:border-[var(--signal)] hover:text-[var(--signal)]")
            }
          >
            <span className="font-mono text-[12px] font-semibold">
              {preset.width}×{preset.height}
            </span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              {preset.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
