"use client";

import { useBuilderStore, type AnimPhase } from "@/state/builder/store";
import type {
  BezierEasing,
  TimelineProperty,
} from "@/server/overlays/builder/types";

/**
 * Wave 3B (Task 11) — EasingPresetDropdown.
 *
 * A small `<select>` that exposes the canonical CSS easing curves as
 * one-click presets per keyframe segment. Picking a named curve writes
 * its cubic-bezier control points to the source keyframe's `easingOut`
 * via the store's `setBezierEasing` action. Picking `custom` is a
 * no-op — the BezierHandle (Task 10) stays the authority and the
 * operator can continue dragging the control points.
 *
 * The dropdown reflects whichever curve the keyframe currently uses:
 * when `easingOut` matches a preset within a 0.01 tolerance per axis
 * the named option is shown; otherwise the dropdown displays `custom`.
 * Tolerance is loose enough to swallow drag jitter (pixel-rounded
 * bezier coordinates drift a few percent off the canonical numbers)
 * but tight enough that a deliberate edit reads as `custom`.
 *
 * Stand-alone for now; intended for embedding inside a keyframe
 * inspector (T12) where the operator already has an active selection.
 */

// Canonical CSS easings — the keys double as the `<option>` values
// and as the strings returned by `matchPreset`. `null` represents the
// `linear` curve since the store stores linear as `easingOut === null`
// (matches the BezierHandle default-render path).
export const EASING_PRESETS: Record<
  "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out",
  BezierEasing | null
> = {
  linear: null,
  ease: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 },
  "ease-in": { x1: 0.42, y1: 0, x2: 1, y2: 1 },
  "ease-out": { x1: 0, y1: 0, x2: 0.58, y2: 1 },
  "ease-in-out": { x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
};

// Per-axis tolerance for round-tripping a stored easing back to its
// preset name. 0.01 is loose enough to swallow drag jitter (the
// BezierHandle rounds to pixel coords, which can drift a few percent
// off the canonical bezier numbers) and tight enough that a deliberate
// off-preset edit reads as `custom`.
const PRESET_MATCH_TOLERANCE = 0.01;

/**
 * Resolve a stored easing back to a preset name.
 *
 * - `null` → `linear` (the canonical CSS default + store representation).
 * - A `BezierEasing` whose four axes all fall within
 *   {@link PRESET_MATCH_TOLERANCE} of a named preset → that preset's name.
 * - Anything else → `custom`.
 *
 * Exported for unit tests; the component consumes it inline.
 */
export function matchPreset(b: BezierEasing | null): string {
  if (!b) return "linear";
  for (const [name, preset] of Object.entries(EASING_PRESETS)) {
    if (!preset) continue;
    if (
      Math.abs(preset.x1 - b.x1) < PRESET_MATCH_TOLERANCE &&
      Math.abs(preset.y1 - b.y1) < PRESET_MATCH_TOLERANCE &&
      Math.abs(preset.x2 - b.x2) < PRESET_MATCH_TOLERANCE &&
      Math.abs(preset.y2 - b.y2) < PRESET_MATCH_TOLERANCE
    ) {
      return name;
    }
  }
  return "custom";
}

export type EasingPresetDropdownProps = {
  /** Owner element id — forwarded into `setBezierEasing`. */
  elementId: string;
  /** Animation phase — forwarded into `setBezierEasing`. */
  phase: AnimPhase;
  /** Track property — forwarded into `setBezierEasing`. */
  property: TimelineProperty;
  /** Id of the "from" keyframe whose `easingOut` this dropdown drives. */
  keyframeId: string;
  /**
   * Current easing on the source keyframe. Reading from props rather
   * than the store keeps the component pure-render so test fixtures
   * can drive it without seeding a design tree.
   */
  easingOut: BezierEasing | null;
};

export function EasingPresetDropdown({
  elementId,
  phase,
  property,
  keyframeId,
  easingOut,
}: EasingPresetDropdownProps) {
  const setBezierEasing = useBuilderStore((s) => s.setBezierEasing);
  const current = matchPreset(easingOut);

  function onChange(name: string) {
    // `custom` is a deliberate no-op — leaves the existing `easingOut`
    // alone so the BezierHandle drag stays the authority. Picking
    // `custom` from the dropdown when the keyframe is already on a
    // named preset is therefore a one-way trapdoor: the operator
    // commits the current bezier as their custom starting point.
    if (name === "custom") return;
    if (!(name in EASING_PRESETS)) return;
    const next =
      EASING_PRESETS[name as keyof typeof EASING_PRESETS] ?? null;
    setBezierEasing(elementId, phase, property, keyframeId, next);
  }

  return (
    <select
      data-testid="easing-preset-dropdown"
      aria-label="Easing preset"
      className="bg-neutral-900 text-xs text-neutral-100 rounded px-2 py-1 border border-neutral-700 focus:outline-none focus:ring-1 focus:ring-[#6bcd06]"
      value={current}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="linear">linear</option>
      <option value="ease">ease</option>
      <option value="ease-in">ease-in</option>
      <option value="ease-out">ease-out</option>
      <option value="ease-in-out">ease-in-out</option>
      <option value="custom">custom…</option>
    </select>
  );
}
