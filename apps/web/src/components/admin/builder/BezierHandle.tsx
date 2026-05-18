"use client";

import { useCallback, useMemo, useRef } from "react";
import { nanoid } from "nanoid";
import { useBuilderStore, type AnimPhase } from "@/state/builder/store";
import type {
  BezierEasing,
  TimelineProperty,
} from "@/server/overlays/builder/types";
import { msToPx } from "./TimelineRuler";

/**
 * Wave 3B (Task 10) — BezierHandle.
 *
 * Renders an SVG cubic-bezier preview between two adjacent keyframes on
 * a property track. The path is anchored at segment-start (bottom-left
 * inside the SVG viewBox, where y=0 is the "from" value) and ends at
 * segment-end (top-right, y=1, the "to" value). Two draggable control
 * circles (P1, P2) sit at the bezier's shape positions and write their
 * updated coordinates back to the source keyframe's `easingOut` via the
 * store's `setBezierEasing` action.
 *
 * Schema clamps (per `BezierEasingSchema` in types.ts):
 *   - x ∈ [0, 1] — time axis must be monotonic for valid CSS cubic-bezier.
 *   - y ∈ [-1, 2] — CSS allows overshoot for spring-like curves.
 *
 * Coordinate frame:
 *   - Local SVG viewBox spans `segmentWidthPx × ROW_HEIGHT_PX`.
 *   - Bezier x in [0, 1] maps to viewBox x via `x * segmentWidthPx`.
 *   - Bezier y in [0, 1] maps to viewBox y via `(1 - y) * ROW_HEIGHT_PX`
 *     (SVG y-axis is inverted vs bezier y-axis: bezier y=1 is the "end"
 *     value at the top, but SVG y=0 is the top).
 *   - The visible path runs from (0, ROW_HEIGHT_PX) — the bottom-left
 *     "from" anchor — to (segmentWidthPx, 0) — the top-right "to" anchor.
 *
 * Default (linear): when `easingOut` is null, control points fall on
 * the endpoints — P1 at (0, 0) and P2 at (1, 1) — yielding a hairline
 * diagonal that matches CSS `linear` timing.
 *
 * Mounted by TimelineTracks (T9) when:
 *   - The "from" keyframe has a non-null `easingOut` set, OR
 *   - Either endpoint keyframe is the currently selected keyframe, OR
 *   - The segment is hovered.
 *
 * The wrapping SVG is `pointer-events: none` so it doesn't block clicks
 * on the underlying clickarea; only the two control circles enable
 * pointer-events for the drag handles.
 */

const ROW_HEIGHT_PX = 28;
const DEFAULT_PX_PER_SECOND = 100;

export type BezierHandleProps = {
  /** Owner element id — forwarded into `setBezierEasing`. */
  elementId: string;
  /** Animation phase — forwarded into `setBezierEasing`. */
  phase: AnimPhase;
  /** Track property — forwarded into `setBezierEasing`. */
  property: TimelineProperty;
  /**
   * Id of the "from" keyframe — the one whose `easingOut` controls
   * this segment. Patches land on this keyframe.
   */
  fromKeyframeId: string;
  /** Start of the segment in milliseconds (the "from" keyframe's timeMs). */
  fromTimeMs: number;
  /** End of the segment in milliseconds (the "to" keyframe's timeMs). */
  toTimeMs: number;
  /**
   * Current easing on the source keyframe (null when linear). Reading
   * from props rather than the store keeps the component pure-render so
   * test fixtures can drive it without seeding the whole design tree.
   */
  easingOut: BezierEasing | null;
  /** Horizontal scale factor; defaults to 100 px/s. */
  pxPerSecond?: number;
};

export function BezierHandle({
  elementId,
  phase,
  property,
  fromKeyframeId,
  fromTimeMs,
  toTimeMs,
  easingOut,
  pxPerSecond = DEFAULT_PX_PER_SECOND,
}: BezierHandleProps) {
  const setBezierEasing = useBuilderStore((s) => s.setBezierEasing);

  // Stable handle id used only for testid generation. Memoised so the
  // testids stay stable across re-renders within the same mount.
  const handleId = useMemo(() => nanoid(6), []);

  // ─────────────────────────────────────────────────────────────
  // Geometry — pixel positions on the SVG canvas
  // ─────────────────────────────────────────────────────────────
  const segmentLeftPx = msToPx(fromTimeMs, pxPerSecond);
  const segmentEndPx = msToPx(toTimeMs, pxPerSecond);
  // Guard against degenerate segments (back-to-back keyframes) — the SVG
  // collapses to width=0 but the component still renders harmlessly.
  const segmentWidthPx = Math.max(0, segmentEndPx - segmentLeftPx);

  // Bezier control points — default to endpoints (linear curve) when no
  // easing is set on the source keyframe.
  const x1 = easingOut?.x1 ?? 0;
  const y1 = easingOut?.y1 ?? 0;
  const x2 = easingOut?.x2 ?? 1;
  const y2 = easingOut?.y2 ?? 1;

  // Map bezier (0..1) coords to viewBox pixel coords. y is inverted so
  // bezier y=0 (start value) is at the bottom of the SVG row, matching
  // typical timeline editor visualisation. Values outside [0,1] still
  // map linearly — y=−1 sits a row below the bottom edge, y=2 sits a
  // row above the top edge. Clipping is left to the schema clamps in
  // the drag handler so the curve preview always renders.
  const px = useCallback(
    (n: number) => n * segmentWidthPx,
    [segmentWidthPx],
  );
  const py = useCallback(
    (n: number) => (1 - n) * ROW_HEIGHT_PX,
    [],
  );

  // ─────────────────────────────────────────────────────────────
  // Drag handlers — write through to store.setBezierEasing
  // ─────────────────────────────────────────────────────────────
  // Snapshot of the per-drag start values; ref so the move handler
  // sees the latest base without re-binding on every mousemove.
  const dragRef = useRef<{
    point: "p1" | "p2";
    startClientX: number;
    startClientY: number;
    base: BezierEasing;
  } | null>(null);

  const makeDrag = useCallback(
    (point: "p1" | "p2") => (e: React.MouseEvent<SVGCircleElement>) => {
      e.preventDefault();
      e.stopPropagation();

      // Bail out cleanly when the segment has zero width — the math
      // would divide by zero below. This guards against degenerate
      // back-to-back keyframes; the visual curve renders but the
      // handles are non-interactive in that edge case.
      if (segmentWidthPx <= 0) return;

      dragRef.current = {
        point,
        startClientX: e.clientX,
        startClientY: e.clientY,
        base: { x1, y1, x2, y2 },
      };

      function onMove(ev: MouseEvent) {
        const drag = dragRef.current;
        if (!drag) return;
        // dx in [0,1] segment-local units; dy is inverted so a downward
        // mouse delta (positive clientY delta) reduces bezier y.
        const dx = (ev.clientX - drag.startClientX) / segmentWidthPx;
        const dy = -(ev.clientY - drag.startClientY) / ROW_HEIGHT_PX;
        const next: BezierEasing = {
          x1: drag.base.x1,
          y1: drag.base.y1,
          x2: drag.base.x2,
          y2: drag.base.y2,
        };
        if (drag.point === "p1") {
          next.x1 = clamp(drag.base.x1 + dx, 0, 1);
          next.y1 = clamp(drag.base.y1 + dy, -1, 2);
        } else {
          next.x2 = clamp(drag.base.x2 + dx, 0, 1);
          next.y2 = clamp(drag.base.y2 + dy, -1, 2);
        }
        setBezierEasing(elementId, phase, property, fromKeyframeId, next);
      }

      function onUp() {
        dragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [
      elementId,
      phase,
      property,
      fromKeyframeId,
      segmentWidthPx,
      setBezierEasing,
      x1,
      y1,
      x2,
      y2,
    ],
  );

  // Path: cubic-bezier from (0, ROW_HEIGHT_PX) to (segmentWidthPx, 0)
  // with control points at (px(x1), py(y1)) and (px(x2), py(y2)).
  const d = `M 0 ${ROW_HEIGHT_PX} C ${px(x1)} ${py(y1)} ${px(x2)} ${py(y2)} ${segmentWidthPx} 0`;

  return (
    <svg
      data-testid={`bezier-handle-${handleId}`}
      data-bezier-handle-wrapper="true"
      data-bezier-from-keyframe-id={fromKeyframeId}
      aria-hidden="true"
      className="pointer-events-none absolute top-0"
      style={{
        left: `${segmentLeftPx}px`,
        width: `${segmentWidthPx}px`,
        height: `${ROW_HEIGHT_PX}px`,
        overflow: "visible",
      }}
      viewBox={`0 0 ${Math.max(1, segmentWidthPx)} ${ROW_HEIGHT_PX}`}
      preserveAspectRatio="none"
    >
      {/* Reference line connecting endpoints → P1 → P2 → endpoint so
          the operator can see which control point pulls which side. */}
      <line
        data-testid={`bezier-handle-${handleId}-leg-p1`}
        x1={0}
        y1={ROW_HEIGHT_PX}
        x2={px(x1)}
        y2={py(y1)}
        stroke="rgba(254, 3, 109, 0.4)"
        strokeWidth={1}
        strokeDasharray="2 2"
      />
      <line
        data-testid={`bezier-handle-${handleId}-leg-p2`}
        x1={segmentWidthPx}
        y1={0}
        x2={px(x2)}
        y2={py(y2)}
        stroke="rgba(254, 3, 109, 0.4)"
        strokeWidth={1}
        strokeDasharray="2 2"
      />
      <path
        data-testid={`bezier-curve-${handleId}`}
        data-bezier-curve="true"
        data-bezier-from-keyframe-id={fromKeyframeId}
        d={d}
        stroke="#6bcd06"
        strokeWidth={1.5}
        fill="none"
      />
      <circle
        data-testid={`bezier-handle-${handleId}-p1`}
        data-bezier-control="p1"
        data-bezier-from-keyframe-id={fromKeyframeId}
        cx={px(x1)}
        cy={py(y1)}
        r={4}
        fill="#fe036d"
        stroke="#ffffff"
        strokeWidth={1}
        className="pointer-events-auto cursor-grab active:cursor-grabbing"
        onMouseDown={makeDrag("p1")}
      />
      <circle
        data-testid={`bezier-handle-${handleId}-p2`}
        data-bezier-control="p2"
        data-bezier-from-keyframe-id={fromKeyframeId}
        cx={px(x2)}
        cy={py(y2)}
        r={4}
        fill="#fe036d"
        stroke="#ffffff"
        strokeWidth={1}
        className="pointer-events-auto cursor-grab active:cursor-grabbing"
        onMouseDown={makeDrag("p2")}
      />
    </svg>
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
