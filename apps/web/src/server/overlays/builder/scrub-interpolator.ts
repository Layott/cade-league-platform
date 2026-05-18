/**
 * Overlay Builder — scrub-preview interpolator.
 *
 * Pure function. Given an `AdvancedTimeline` (zero or more property
 * tracks, each with ≥2 keyframes) and a `timeMs` cursor, walks every
 * track and returns the current resolved value per animated property.
 *
 * Consumers:
 *   - Wave 3B Task 14 — `CanvasStage` subscribes to `timelineCursorMs`
 *     and applies the patch on top of the element's static transform /
 *     style so the operator sees a live preview while dragging.
 *   - E2E / visual-regression — assert mid-segment frames carry the
 *     interpolated values (e.g. opacity ≈ 0.5 at 50% progress).
 *
 * Behaviour:
 *   - Cursor before the first keyframe → snap to first keyframe's value.
 *   - Cursor at or after the last keyframe → snap to last keyframe's
 *     value (matches the `forwards` fill-mode semantics in the compiler
 *     output).
 *   - Cursor inside a segment [prev, next]:
 *       progress = (timeMs - prev.timeMs) / (next.timeMs - prev.timeMs)
 *       easedT   = prev.easingOut ? cubicBezierProgress(easingOut, progress) : progress
 *       value    = numeric → lerp(prev.value, next.value, easedT)
 *                  string  → prev.value   (can't interp colors / filters
 *                                          mid-segment, so snap to the
 *                                          most-recent keyframe — same
 *                                          rule the compiler applies in
 *                                          `resolveTrackValueAtMs`).
 *
 * No DOM, no zustand, no Supabase — strictly value-in/value-out so this
 * runs from server actions, client hooks, and tests with the same API.
 *
 * Spec: docs/superpowers/plans/2026-05-17-overlay-builder-wave-3b.md
 *       (Task 13).
 */

import type {
  AdvancedTimeline,
  AdvancedTimelineTrack,
  BezierEasing,
  Keyframe,
} from "./types";

export type InterpolatedPatch = Partial<{
  opacity: number;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  color: string;
  filter: string;
}>;

/**
 * Walk every track in `timeline` and resolve its value at `timeMs`.
 * Properties absent from the timeline are absent from the returned
 * patch (so consumers can spread it over the element's defaults
 * without nuking anything they didn't animate).
 */
export function interpolateAt(
  timeline: AdvancedTimeline,
  timeMs: number,
): InterpolatedPatch {
  const out: InterpolatedPatch = {};
  for (const track of timeline) {
    const value = resolveTrackAt(track, timeMs);
    if (value === undefined) continue;
    // Property keys come straight from the Zod enum so this assignment
    // is safe — every TimelineProperty maps to a key on InterpolatedPatch.
    (out as Record<string, number | string>)[track.property] = value;
  }
  return out;
}

/**
 * Alias retained for symmetry with the original Wave 3B plan-body
 * sketch (`interpolateAtMs`). New code should prefer `interpolateAt`.
 */
export const interpolateAtMs = interpolateAt;

function resolveTrackAt(
  track: AdvancedTimelineTrack,
  timeMs: number,
): number | string | undefined {
  const kfs = track.keyframes;
  if (kfs.length === 0) return undefined;

  const first = kfs[0]!;
  const last = kfs[kfs.length - 1]!;
  if (timeMs <= first.timeMs) return first.value;
  if (timeMs >= last.timeMs) return last.value;

  // Find the bracket [prev, next] surrounding timeMs. Keyframes are
  // expected to be time-sorted (the editor enforces this on insert /
  // drag); a defensive scan is still O(n) per track which is fine for
  // realistic timelines (≤ a dozen keyframes per track).
  let prev: Keyframe = first;
  let next: Keyframe = last;
  for (let i = 1; i < kfs.length; i++) {
    const k = kfs[i]!;
    if (k.timeMs >= timeMs) {
      prev = kfs[i - 1]!;
      next = k;
      break;
    }
  }

  const segmentDuration = next.timeMs - prev.timeMs;
  // Degenerate zero-width segment — snap to prev. (Cursor can't land
  // strictly between two keyframes that share a timeMs.)
  if (segmentDuration <= 0) return prev.value;

  const progress = (timeMs - prev.timeMs) / segmentDuration;
  const easedT = prev.easingOut
    ? cubicBezierProgress(prev.easingOut, progress)
    : progress;

  if (typeof prev.value === "number" && typeof next.value === "number") {
    return prev.value + (next.value - prev.value) * easedT;
  }
  // String values (color, filter) can't be cleanly interpolated in pure
  // JS without a parser — match the compiler's behaviour by holding the
  // prior keyframe's value until the next one lands.
  return prev.value;
}

/**
 * Evaluate a CSS cubic-bezier easing curve at progress `t ∈ [0, 1]`.
 *
 * Curve is defined by control points (0, 0), (x1, y1), (x2, y2), (1, 1).
 * The forward map B(s) = (Bx(s), By(s)) is parameterised by `s ∈ [0, 1]`
 * (NOT by t directly — Bx(s) is monotonic but not linear in s, so we
 * have to invert Bx to find the `s` that satisfies Bx(s) = t, then
 * evaluate By(s).
 *
 * Newton-Raphson with up to 8 iterations + a falls-back bisection clamp
 * (which has never been observed to trigger on the [0,1]×[0,1] subset
 * of curves CSS accepts but is included for paranoia). Tolerance 1e-6
 * is well below sub-pixel visual precision.
 *
 * Pure / deterministic — same `(b, t)` always returns the same number.
 */
export function cubicBezierProgress(b: BezierEasing, t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  // Linear shortcut — if both control points are on the diagonal the
  // curve degenerates to y = x.
  if (b.x1 === b.y1 && b.x2 === b.y2) return t;

  const s = solveBezierS(b.x1, b.x2, t);
  return bezierAxis(b.y1, b.y2, s);
}

/**
 * Single-axis cubic-bezier evaluation:
 *   B(s) = 3·(1-s)²·s·p1 + 3·(1-s)·s²·p2 + s³
 * (endpoint terms drop out because they're 0 and 1 respectively).
 */
function bezierAxis(p1: number, p2: number, s: number): number {
  const oneMinusS = 1 - s;
  return (
    3 * oneMinusS * oneMinusS * s * p1 +
    3 * oneMinusS * s * s * p2 +
    s * s * s
  );
}

/**
 * dB/ds for the single-axis form above. Used by Newton-Raphson.
 */
function bezierAxisDerivative(p1: number, p2: number, s: number): number {
  const oneMinusS = 1 - s;
  return (
    3 * oneMinusS * oneMinusS * p1 +
    6 * oneMinusS * s * (p2 - p1) +
    3 * s * s * (1 - p2)
  );
}

/**
 * Find s such that Bx(s) = x. Newton-Raphson with bisection fallback.
 */
function solveBezierS(x1: number, x2: number, x: number): number {
  let s = x; // good initial guess for typical "ease" curves
  for (let i = 0; i < 8; i++) {
    const currentX = bezierAxis(x1, x2, s) - x;
    if (Math.abs(currentX) < 1e-6) return s;
    const slope = bezierAxisDerivative(x1, x2, s);
    if (Math.abs(slope) < 1e-6) break;
    s -= currentX / slope;
  }

  // Bisection fallback — guaranteed to converge because Bx is monotonic
  // on x1 ∈ [0, 1], x2 ∈ [0, 1] (CSS-constrained).
  let lo = 0;
  let hi = 1;
  let mid = s;
  for (let i = 0; i < 32; i++) {
    mid = (lo + hi) / 2;
    const currentX = bezierAxis(x1, x2, mid);
    if (Math.abs(currentX - x) < 1e-6) return mid;
    if (currentX < x) lo = mid;
    else hi = mid;
  }
  return mid;
}
