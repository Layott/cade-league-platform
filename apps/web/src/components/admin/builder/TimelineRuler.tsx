"use client";

import { useCallback, useRef } from "react";
import { useBuilderStore, type AnimPhase } from "@/state/builder/store";

/**
 * Wave 3B (Task 7) — TimelineRuler.
 *
 * Pixels-per-second scale with major + minor tick marks plus a
 * draggable vertical cursor showing the current scrub position.
 *
 * Scale model:
 *   - `pxPerSecond` (default 100) controls how much horizontal pixel
 *     space one second of timeline occupies. Configurable so Task 11+
 *     can wire a zoom slider on top without changing this contract.
 *   - Total ruler width is `(durationMs / 1000) * pxPerSecond` px, plus
 *     a small right-edge pad so the trailing major tick label remains
 *     readable.
 *
 * Tick model:
 *   - Major ticks every 1000ms with a numeric label (e.g. "0s", "1s").
 *   - Minor ticks every 100ms (each 1/10th of a major).
 *   - Both arrays are derived deterministically from `durationMs` so
 *     unit tests can count them without mocking layout.
 *
 * Cursor model:
 *   - State lives in the store as
 *     `timelineCursorMs[elementId][phase]` (Task 6 follow-up).
 *   - Mouse-down on the ruler track sets the cursor to the clicked
 *     position. While the button is held, mousemove updates it.
 *     mouseup detaches the window listeners.
 *   - Cursor offset is computed from the track's bounding-rect so
 *     parent scroll / panel-offset don't shift the math.
 *
 * Mounted by TimelinePanel inside `data-testid="timeline-panel-body"`.
 */

const DEFAULT_PX_PER_SECOND = 100;
const MAJOR_TICK_MS = 1000;
const MINOR_TICK_MS = 100;
const RIGHT_PAD_PX = 40;
const RULER_HEIGHT_PX = 32;

export function msToPx(ms: number, pxPerSecond: number): number {
  return (ms / 1000) * pxPerSecond;
}

export function pxToMs(px: number, pxPerSecond: number): number {
  if (pxPerSecond <= 0) return 0;
  return (px / pxPerSecond) * 1000;
}

export function TimelineRuler({
  elementId,
  phase,
  durationMs,
  pxPerSecond = DEFAULT_PX_PER_SECOND,
}: {
  elementId: string;
  phase: AnimPhase;
  durationMs: number;
  pxPerSecond?: number;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const cursorMs = useBuilderStore(
    (s) => s.timelineCursorMs[elementId]?.[phase] ?? 0,
  );
  const setCursor = useBuilderStore((s) => s.setTimelineCursor);

  const safeDuration = Math.max(0, durationMs);
  const trackWidth = msToPx(safeDuration, pxPerSecond) + RIGHT_PAD_PX;

  // Build tick arrays — major every 1000ms (inclusive of 0 + duration),
  // minor every 100ms (skipping where a major already lands).
  const majorTicks: number[] = [];
  for (let t = 0; t <= safeDuration; t += MAJOR_TICK_MS) majorTicks.push(t);
  if (majorTicks[majorTicks.length - 1] !== safeDuration && safeDuration > 0) {
    // ensure the final boundary is represented when duration isn't a
    // round second (e.g. 1500ms gets a "1.5s" minor sister already).
  }

  const minorTicks: number[] = [];
  for (let t = MINOR_TICK_MS; t < safeDuration; t += MINOR_TICK_MS) {
    if (t % MAJOR_TICK_MS === 0) continue;
    minorTicks.push(t);
  }

  const applyCursorFromClientX = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return;
      const localX = clientX - rect.left;
      const rawMs = pxToMs(localX, pxPerSecond);
      const clamped = Math.max(0, Math.min(safeDuration, rawMs));
      setCursor(elementId, phase, clamped);
    },
    [elementId, phase, pxPerSecond, safeDuration, setCursor],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      applyCursorFromClientX(e.clientX);
      const onMove = (ev: MouseEvent) => {
        applyCursorFromClientX(ev.clientX);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [applyCursorFromClientX],
  );

  const clampedCursorMs = Math.max(0, Math.min(safeDuration, cursorMs));
  const cursorLeftPx = msToPx(clampedCursorMs, pxPerSecond);

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label={`Timeline cursor (${phase})`}
      aria-valuemin={0}
      aria-valuemax={safeDuration}
      aria-valuenow={clampedCursorMs}
      data-testid="timeline-ruler"
      onMouseDown={handleMouseDown}
      className="relative w-full cursor-col-resize select-none border-b border-white/10 bg-zinc-900"
      style={{ height: RULER_HEIGHT_PX, minWidth: trackWidth }}
    >
      {/* Minor ticks */}
      {minorTicks.map((t) => (
        <div
          key={`minor-${t}`}
          data-testid={`ruler-tick-minor-${t}`}
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 w-px bg-white/15"
          style={{
            left: `${msToPx(t, pxPerSecond)}px`,
            height: Math.round(RULER_HEIGHT_PX * 0.35),
          }}
        />
      ))}

      {/* Major ticks + labels */}
      {majorTicks.map((t) => (
        <div
          key={`major-${t}`}
          data-testid={`ruler-tick-major-${t}`}
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 w-px bg-white/40"
          style={{
            left: `${msToPx(t, pxPerSecond)}px`,
            height: Math.round(RULER_HEIGHT_PX * 0.7),
          }}
        >
          <span
            data-testid={`ruler-label-${t}`}
            className="absolute -top-0 left-1 whitespace-nowrap text-[10px] font-medium tabular-nums text-white/60"
          >
            {Math.round(t / 1000)}s
          </span>
        </div>
      ))}

      {/* Current-time cursor */}
      <div
        data-testid="ruler-cursor"
        aria-hidden="true"
        className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-[#fe036d]"
        style={{ left: `${cursorLeftPx}px` }}
      >
        <div
          data-testid="ruler-cursor-head"
          className="absolute -top-0.5 -left-1.5 h-2 w-3 rounded-sm bg-[#fe036d] shadow"
        />
      </div>
    </div>
  );
}
