"use client";

import { useCallback, useRef } from "react";
import { msToPx, pxToMs } from "./TimelineRuler";

/**
 * Wave 3B (Task 8) — KeyframeNode.
 *
 * Renders one keyframe as a 10×10 diamond (a 45deg-rotated square)
 * positioned at `msToPx(timeMs, pxPerSecond)` along a per-property
 * sub-track inside a TimelineTracks row.
 *
 * Interaction model:
 *   - `onMouseDown` is treated as both the click that selects the node
 *     and the start of a potential horizontal drag. Selection fires the
 *     `onSelect(keyframeId)` callback so the parent (TimelineTracks, T9)
 *     can route the id into the store's selection slot. Wiring select →
 *     store is intentionally deferred to T9; this component stays
 *     prop-driven so it can be unit-tested in isolation.
 *   - During drag, mousemove on the window converts pixel delta to ms
 *     using the same `pxPerSecond` scale as TimelineRuler, then calls
 *     `onTimeChange(newTimeMs)` clamped to `[0, durationMs]`.
 *   - `onTimeChange` is optional — when omitted the node still selects
 *     on click but renders as a read-only marker.
 *
 * Visual model:
 *   - Brand green (#6bcd06) when `selected={true}` with a white ring.
 *   - Neutral white/50 fill at rest with a brand-pink (#fe036d) hover
 *     accent so unselected nodes still telegraph "draggable" without
 *     stealing focus from the selected one.
 *   - Position is computed from `containerRect` left edge (if provided)
 *     so the math survives parent scroll / margin offsets. When
 *     `containerRect` is null the math falls back to clientX deltas
 *     relative to the mousedown clientX, which is what most tests
 *     exercise.
 *
 * Mounted by TimelineTracks (T9) once per (property × keyframe).
 */

const DEFAULT_PX_PER_SECOND = 100;
const NODE_SIZE_PX = 10;

export type KeyframeNodeProps = {
  /** Unique keyframe id (sourced from `state.design...keyframes[].id`). */
  id: string;
  /** Position on the track in milliseconds. */
  timeMs: number;
  /** Phase total length used for the drag clamp. */
  durationMs: number;
  /** Horizontal scale factor; defaults to 100 px/s (TimelineRuler T7). */
  pxPerSecond?: number;
  /** True when this keyframe is the currently selected one in the store. */
  selected?: boolean;
  /** Fires on mousedown with the keyframe id so the parent can select. */
  onSelect?: (keyframeId: string) => void;
  /**
   * Fires during drag with the next `timeMs` already clamped to
   * `[0, durationMs]`. Omit to render a read-only marker.
   */
  onTimeChange?: (nextTimeMs: number) => void;
  /**
   * Track-row bounding-rect (parent track), captured by the consumer once
   * per render. When provided, drag math subtracts `rect.left` so the
   * absolute pixel position is rect-local and survives parent scroll.
   * jsdom returns zeros for getBoundingClientRect so tests typically
   * pass `null` and exercise the clientX-delta fallback path.
   */
  containerRect?: DOMRect | null;
};

export function KeyframeNode({
  id,
  timeMs,
  durationMs,
  pxPerSecond = DEFAULT_PX_PER_SECOND,
  selected = false,
  onSelect,
  onTimeChange,
  containerRect = null,
}: KeyframeNodeProps) {
  // Hold the rect snapshot in a ref so the mousemove handler sees the
  // latest captured value without re-binding on every render.
  const rectRef = useRef<DOMRect | null>(containerRect);
  rectRef.current = containerRect;

  const safeDuration = Math.max(0, durationMs);
  const clampedTime = Math.max(0, Math.min(safeDuration, timeMs));
  const left = msToPx(clampedTime, pxPerSecond);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      onSelect?.(id);

      if (!onTimeChange) return;
      const change: (ms: number) => void = onTimeChange;

      const startClientX = e.clientX;
      const startMs = clampedTime;

      function onMove(ev: MouseEvent) {
        let nextMs: number;
        const rect = rectRef.current;
        if (rect) {
          const localX = ev.clientX - rect.left;
          nextMs = pxToMs(localX, pxPerSecond);
        } else {
          const dxPx = ev.clientX - startClientX;
          const dMs = pxToMs(dxPx, pxPerSecond);
          nextMs = startMs + dMs;
        }
        const clamped = Math.max(0, Math.min(safeDuration, nextMs));
        change(clamped);
      }
      function onUp() {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [id, clampedTime, onSelect, onTimeChange, pxPerSecond, safeDuration],
  );

  return (
    <div
      role="button"
      tabIndex={-1}
      aria-label={`Keyframe at ${Math.round(clampedTime)}ms${
        selected ? " (selected)" : ""
      }`}
      data-testid={`keyframe-node-${id}`}
      data-selected={selected ? "true" : "false"}
      onMouseDown={handleMouseDown}
      style={{
        left: `${left}px`,
        width: NODE_SIZE_PX,
        height: NODE_SIZE_PX,
      }}
      className={[
        "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-pointer select-none transition-colors",
        selected
          ? "bg-[#6bcd06] ring-1 ring-white shadow-[0_0_6px_rgba(107,205,6,0.6)]"
          : "bg-white/60 hover:bg-[#fe036d]",
      ].join(" ")}
    />
  );
}
