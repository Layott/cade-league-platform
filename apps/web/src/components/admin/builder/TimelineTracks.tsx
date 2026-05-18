"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useBuilderStore,
  type AnimPhase,
} from "@/state/builder/store";
import type {
  BezierEasing,
  Element,
  TimelineProperty,
} from "@/server/overlays/builder/types";
import { KeyframeNode } from "./KeyframeNode";
import { BezierHandle } from "./BezierHandle";
import { pxToMs } from "./TimelineRuler";

/**
 * Wave 3B (Task 9) — TimelineTracks.
 *
 * Per-element, per-phase list of property tracks rendered as horizontal
 * rows inside the TimelinePanel body. Each row has:
 *   - A fixed-width gutter (80px) on the left with the property label.
 *   - A flexible click-area on the right with one {@link KeyframeNode}
 *     diamond per keyframe positioned at `msToPx(timeMs, pxPerSecond)`.
 *
 * Interaction model:
 *   - Click on empty space inside a row's click-area → call
 *     {@link useBuilderStore.addKeyframe} with the px-converted ms and a
 *     sensible default value for the property (opacity:1, x:0, etc.).
 *   - Mousedown on a KeyframeNode → select it (writes to
 *     `selectedKeyframeId` in the store). The KeyframeNode itself fires
 *     `stopPropagation` so the empty-area click handler does not also
 *     trigger an add. Drag-then-release on the same node continues to
 *     forward `timeMs` updates through {@link useBuilderStore.updateKeyframe}.
 *   - Delete / Backspace on a focused row → if the selected keyframe
 *     belongs to that row's track AND the row has >2 keyframes, call
 *     {@link useBuilderStore.removeKeyframe}. Below the 2-keyframe floor
 *     the store collapses the whole track (per Wave 3B schema floor), so
 *     the row would disappear; we leave that as legitimate behaviour.
 *
 * Ghost rows (40% opacity) render for the 7 properties that don't have
 * a track yet, so producers can seed a new property simply by clicking
 * its row. The store's `addKeyframe` action creates the track on demand.
 *
 * Pure-render props: this component reads everything it needs out of
 * the store directly so callers only pass `phase` + `element`. That
 * keeps the wiring inside TimelinePanel as one line.
 */

const DEFAULT_PX_PER_SECOND = 100;
const ROW_HEIGHT_PX = 28;
const GUTTER_WIDTH_PX = 80;

const ALL_PROPERTIES: TimelineProperty[] = [
  "opacity",
  "x",
  "y",
  "scaleX",
  "scaleY",
  "rotation",
  "color",
  "filter",
];

const DEFAULT_VALUE_FOR: Record<TimelineProperty, number | string> = {
  opacity: 1,
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  color: "#ffffff",
  filter: "none",
};

export function TimelineTracks({
  element,
  phase,
  pxPerSecond = DEFAULT_PX_PER_SECOND,
}: {
  element: Element;
  phase: AnimPhase;
  pxPerSecond?: number;
}) {
  const addKeyframe = useBuilderStore((s) => s.addKeyframe);
  const updateKeyframe = useBuilderStore((s) => s.updateKeyframe);
  const removeKeyframe = useBuilderStore((s) => s.removeKeyframe);
  const selectKeyframe = useBuilderStore((s) => s.selectKeyframe);
  const selectedKeyframeId = useBuilderStore((s) => s.selectedKeyframeId);

  const phaseAnim = element.animation?.[phase];
  const tracks = phaseAnim?.advancedTimeline ?? [];
  const durationMs = Math.max(0, phaseAnim?.durationMs ?? 0);

  return (
    <div
      data-testid="timeline-tracks"
      role="list"
      aria-label="Timeline property tracks"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
    >
      {ALL_PROPERTIES.map((property) => {
        const track = tracks.find((t) => t.property === property);
        return (
          <TrackRow
            key={property}
            element={element}
            phase={phase}
            property={property}
            track={track}
            durationMs={durationMs}
            pxPerSecond={pxPerSecond}
            selectedKeyframeId={selectedKeyframeId}
            addKeyframe={addKeyframe}
            updateKeyframe={updateKeyframe}
            removeKeyframe={removeKeyframe}
            selectKeyframe={selectKeyframe}
          />
        );
      })}
    </div>
  );
}

type TrackRowProps = {
  element: Element;
  phase: AnimPhase;
  property: TimelineProperty;
  track:
    | {
        property: TimelineProperty;
        keyframes: Array<{
          id: string;
          timeMs: number;
          value: number | string;
          easingOut?: BezierEasing | null;
        }>;
      }
    | undefined;
  durationMs: number;
  pxPerSecond: number;
  selectedKeyframeId: string | null;
  addKeyframe: ReturnType<typeof useBuilderStore.getState>["addKeyframe"];
  updateKeyframe: ReturnType<typeof useBuilderStore.getState>["updateKeyframe"];
  removeKeyframe: ReturnType<typeof useBuilderStore.getState>["removeKeyframe"];
  selectKeyframe: ReturnType<typeof useBuilderStore.getState>["selectKeyframe"];
};

function TrackRow({
  element,
  phase,
  property,
  track,
  durationMs,
  pxPerSecond,
  selectedKeyframeId,
  addKeyframe,
  updateKeyframe,
  removeKeyframe,
  selectKeyframe,
}: TrackRowProps) {
  const clickAreaRef = useRef<HTMLDivElement | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // Per-segment hover so BezierHandle is only visible for the segment
  // the operator is interacting with (unless `easingOut` is set or the
  // segment is selected, in which case visibility is forced on). We key
  // by the "from" keyframe id since that uniquely identifies a segment.
  const [hoveredSegmentFromId, setHoveredSegmentFromId] = useState<
    string | null
  >(null);
  const isGhost = !track;

  // Adjacent keyframe pairs sorted by timeMs so the bezier preview spans
  // the correct interval even if the underlying array isn't pre-sorted.
  // Keyframes are normally inserted in time order by the store, but
  // sorting defensively keeps the math correct under any ordering.
  const sortedKeyframes = track
    ? [...track.keyframes].sort((a, b) => a.timeMs - b.timeMs)
    : [];
  const segments: Array<{
    fromId: string;
    fromTimeMs: number;
    toId: string;
    toTimeMs: number;
    easingOut: BezierEasing | null;
  }> = [];
  for (let i = 0; i < sortedKeyframes.length - 1; i++) {
    const from = sortedKeyframes[i];
    const to = sortedKeyframes[i + 1];
    segments.push({
      fromId: from.id,
      fromTimeMs: from.timeMs,
      toId: to.id,
      toTimeMs: to.timeMs,
      easingOut: from.easingOut ?? null,
    });
  }

  // Capture the click-area's bounding rect once the row mounts so the
  // KeyframeNode drag math can use rect-relative pixel coords (it falls
  // back to clientX-delta when null). Refreshed on layout changes via
  // ResizeObserver so panel resize doesn't desync the drag.
  useEffect(() => {
    const node = clickAreaRef.current;
    if (!node) return;
    setRect(node.getBoundingClientRect());
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setRect(node.getBoundingClientRect());
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const handleClickArea = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Accept clicks on the row itself OR on transparent overlays we
      // know don't carry their own click handler — namely the per-
      // segment hover strip (pointer-events:auto, used solely for
      // hover state) and any descendant of the bezier-handle SVG
      // (the SVG itself is pointer-events:none; the drag knobs
      // stopPropagation in their onMouseDown so they never bubble
      // here either). KeyframeNode children stopPropagation in their
      // onMouseDown, so clicks on existing keyframes never reach us.
      const node = clickAreaRef.current;
      if (!node) return;
      const target = e.target as HTMLElement | null;
      if (target && target !== e.currentTarget) {
        const tid = target.getAttribute?.("data-testid") ?? "";
        const closestKeyframe = target.closest?.(
          '[data-testid^="keyframe-node-"]',
        );
        if (closestKeyframe) return; // click on an existing keyframe
        if (!tid.startsWith("bezier-segment-hover-") && tid !== "") {
          // Some other testid'd descendant — bail.
          return;
        }
      }
      const r = node.getBoundingClientRect();
      const localX = e.clientX - r.left;
      const rawMs = pxToMs(localX, pxPerSecond);
      const clamped = Math.max(0, Math.min(durationMs, rawMs));
      addKeyframe(
        element.id,
        phase,
        property,
        clamped,
        DEFAULT_VALUE_FOR[property],
      );
    },
    [
      addKeyframe,
      element.id,
      phase,
      property,
      pxPerSecond,
      durationMs,
    ],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (!selectedKeyframeId) return;
      if (!track) return;
      const owns = track.keyframes.some((k) => k.id === selectedKeyframeId);
      if (!owns) return;
      e.preventDefault();
      removeKeyframe(element.id, phase, property, selectedKeyframeId);
      selectKeyframe(null);
    },
    [
      element.id,
      phase,
      property,
      removeKeyframe,
      selectKeyframe,
      selectedKeyframeId,
      track,
    ],
  );

  return (
    <div
      role="listitem"
      data-testid={`track-row-${property}`}
      data-ghost={isGhost ? "true" : "false"}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={[
        "flex items-stretch border-b border-white/10 outline-none focus-within:bg-white/[0.02]",
        isGhost ? "opacity-40" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ height: ROW_HEIGHT_PX }}
    >
      <div
        data-testid={`track-row-${property}-label`}
        className="flex shrink-0 items-center border-r border-white/10 px-2 text-[11px] font-medium tabular-nums text-white/60"
        style={{ width: GUTTER_WIDTH_PX }}
      >
        {property}
      </div>
      <div
        ref={clickAreaRef}
        data-testid={`track-row-${property}-clickarea`}
        onClick={handleClickArea}
        className="relative min-w-0 flex-1 cursor-cell select-none bg-zinc-950"
      >
        {/* BezierHandle previews render below the keyframe nodes so the
            10×10 diamond markers stay on top of the curve. Visibility
            rule per Wave 3B (Task 10): show when the segment's
            easingOut is non-null OR the segment is hovered OR either
            endpoint keyframe is the currently selected one.

            Hover detection lives on a 4px-tall transparent strip at the
            row's vertical mid-line, sized to the segment. The strip is
            always mounted (regardless of BezierHandle visibility) so
            hover state can start AND end reliably — the BezierHandle's
            wrapper SVG has pointer-events:none so its mouseleave is
            unreliable across the curve's transparent areas. Strip is
            4px tall + bottomed at row mid-height so it never steals
            clicks meant for the clickarea (the rest of the row remains
            click-throughable into `handleClickArea`). */}
        {segments.map((seg) => {
          const isSelected =
            selectedKeyframeId === seg.fromId ||
            selectedKeyframeId === seg.toId;
          const isHovered = hoveredSegmentFromId === seg.fromId;
          const hasEasing = seg.easingOut !== null;
          const visible = hasEasing || isSelected || isHovered;
          const leftPx = (seg.fromTimeMs / 1000) * pxPerSecond;
          const widthPx =
            ((seg.toTimeMs - seg.fromTimeMs) / 1000) * pxPerSecond;
          return (
            <div key={`seg-${seg.fromId}`}>
              <div
                data-testid={`bezier-segment-hover-${seg.fromId}`}
                onMouseEnter={() => setHoveredSegmentFromId(seg.fromId)}
                onMouseLeave={() =>
                  setHoveredSegmentFromId((cur) =>
                    cur === seg.fromId ? null : cur,
                  )
                }
                className="pointer-events-auto absolute"
                style={{
                  left: `${leftPx}px`,
                  top: `${ROW_HEIGHT_PX / 2 - 2}px`,
                  width: `${widthPx}px`,
                  height: "4px",
                }}
              />
              {visible ? (
                <BezierHandle
                  elementId={element.id}
                  phase={phase}
                  property={property}
                  fromKeyframeId={seg.fromId}
                  fromTimeMs={seg.fromTimeMs}
                  toTimeMs={seg.toTimeMs}
                  easingOut={seg.easingOut}
                  pxPerSecond={pxPerSecond}
                />
              ) : null}
            </div>
          );
        })}
        {track?.keyframes.map((kf) => (
          <KeyframeNode
            key={kf.id}
            id={kf.id}
            timeMs={kf.timeMs}
            durationMs={durationMs}
            pxPerSecond={pxPerSecond}
            selected={selectedKeyframeId === kf.id}
            onSelect={(id) => selectKeyframe(id)}
            onTimeChange={(nextMs) =>
              updateKeyframe(element.id, phase, property, kf.id, {
                timeMs: nextMs,
              })
            }
            containerRect={rect}
          />
        ))}
      </div>
    </div>
  );
}
