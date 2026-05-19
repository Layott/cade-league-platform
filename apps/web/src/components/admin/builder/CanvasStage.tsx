"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Stage, Layer, Rect, Text, Image as KImage, Ellipse, Line, RegularPolygon, Line as KLine, Group, Transformer } from "react-konva";
import { useBuilderStore, type AnimPhase } from "@/state/builder/store";
import { useImage } from "./useImage";
import type { Element } from "@/server/overlays/builder/types";
import { useAlignmentGuides, computeAlignmentGuides } from "./use-alignment-guides";
import { PathPenOverlay } from "./PathPenOverlay";
import {
  interpolateAt,
  type InterpolatedPatch,
} from "@/server/overlays/builder/scrub-interpolator";

// ─────────────────────────────────────────────────────────────
// Wave 3B (Task 14) — scrub-preview hook.
//
// While the operator drags the timeline cursor, CanvasStage layers an
// `interpolateAt(timeline, cursorMs)` patch on top of the rendered
// element so they see the keyframe values resolved at that instant.
//
// The override is purely client-side: the canonical zustand `Design`
// stays unchanged. Saving persists keyframes — not preview snapshots.
//
// Gating: returns `{}` (no patch) unless ALL of:
//   - `timelinePanelOpen` is true.
//   - The rendered element is the one operator is editing — i.e. it
//     is the sole selected element. CanvasStage only narrows to a
//     single edit target when the TimelinePanel mounts, so this
//     mirrors that contract.
//   - A `timelineCursorMs[elementId]` entry exists for a phase that
//     ALSO carries an `advancedTimeline` on that phase. The active
//     phase is derived first from the currently selected keyframe's
//     owning phase (if any), then by scanning entry → loop → exit
//     for the first phase that has both a cursor and a timeline.
//     With no cursor anywhere, no preview fires — the static design
//     state remains the source of truth.
// ─────────────────────────────────────────────────────────────

const PHASE_PRIORITY: readonly AnimPhase[] = ["entry", "loop", "exit"];

function resolveActivePhaseAndCursor(
  element: Element,
  cursorByPhase: Partial<Record<AnimPhase, number>> | undefined,
  selectedKeyframeId: string | null,
): { phase: AnimPhase; cursorMs: number } | null {
  // 1. Selected keyframe's phase wins — find which phase's timeline
  //    owns the kf id. Allows operator to scrub inside the phase they
  //    are inspecting even when other phases have stale cursors.
  if (selectedKeyframeId) {
    for (const phase of PHASE_PRIORITY) {
      const tl = element.animation?.[phase]?.advancedTimeline;
      if (!tl) continue;
      for (const track of tl) {
        if (track.keyframes.some((k) => k.id === selectedKeyframeId)) {
          const ms = cursorByPhase?.[phase];
          if (typeof ms === "number") return { phase, cursorMs: ms };
        }
      }
    }
  }
  // 2. Fall back to first phase with both a cursor entry AND an
  //    advanced timeline. PHASE_PRIORITY puts `entry` first so the
  //    natural author flow (entry-edit → preview) lands here.
  if (cursorByPhase) {
    for (const phase of PHASE_PRIORITY) {
      const ms = cursorByPhase[phase];
      if (typeof ms !== "number") continue;
      const tl = element.animation?.[phase]?.advancedTimeline;
      if (!tl || tl.length === 0) continue;
      return { phase, cursorMs: ms };
    }
  }
  return null;
}

function useScrubPreview(element: Element): InterpolatedPatch {
  const panelOpen = useBuilderStore((s) => s.timelinePanelOpen);
  const selectedIds = useBuilderStore((s) => s.selectedElementIds);
  const cursorByPhase = useBuilderStore(
    (s) => s.timelineCursorMs[element.id],
  );
  const selectedKeyframeId = useBuilderStore((s) => s.selectedKeyframeId);

  // Only the singly-selected element gets a preview — matches
  // TimelinePanel's own mount gate (`selectedIds.length === 1`).
  const isEditTarget =
    selectedIds.length === 1 && selectedIds[0] === element.id;

  return useMemo<InterpolatedPatch>(() => {
    if (!panelOpen || !isEditTarget) return {};
    const active = resolveActivePhaseAndCursor(
      element,
      cursorByPhase,
      selectedKeyframeId,
    );
    if (!active) return {};
    const timeline = element.animation?.[active.phase]?.advancedTimeline;
    if (!timeline || timeline.length === 0) return {};
    return interpolateAt(timeline, active.cursorMs);
  }, [
    panelOpen,
    isEditTarget,
    element,
    cursorByPhase,
    selectedKeyframeId,
  ]);
}

/**
 * Apply a scrub-preview patch on top of an element's static transform
 * + style. `x` / `y` keyframe values are deltas (matches the runtime
 * compiler that emits `translate(x, y)` rather than rewriting
 * absolute coords); every other property overrides the base value.
 *
 * Returns a plain `{ transform, style }` pair so renderers consume it
 * the same way they consume the canonical element fields.
 */
function applyScrubPatch(
  el: Element,
  patch: InterpolatedPatch,
): { transform: Element["transform"]; style: Element["style"] } {
  if (
    patch.x === undefined &&
    patch.y === undefined &&
    patch.opacity === undefined &&
    patch.scaleX === undefined &&
    patch.scaleY === undefined &&
    patch.rotation === undefined &&
    patch.color === undefined &&
    patch.filter === undefined
  ) {
    return { transform: el.transform, style: el.style };
  }
  const base = el.transform;
  const transform: Element["transform"] = {
    ...base,
    x: patch.x !== undefined ? base.x + patch.x : base.x,
    y: patch.y !== undefined ? base.y + patch.y : base.y,
    opacity: patch.opacity ?? base.opacity,
    scaleX: patch.scaleX ?? base.scaleX,
    scaleY: patch.scaleY ?? base.scaleY,
    rotation: patch.rotation ?? base.rotation,
  };
  // Style patch values are strings — keep them untouched when absent
  // so the existing optional chaining in renderers continues to work.
  // `filter` arrives as a raw CSS string (its scrub-interpolator form)
  // while the canonical `style.filter` is a structured `FilterSpec`
  // the renderers consume field-by-field. We deliberately skip the
  // filter override here because round-tripping CSS → FilterSpec mid-
  // scrub would silently drop fields; color flows through cleanly
  // because the renderers read `style.color` as a raw string already.
  const styleBase = el.style ?? {};
  const style: Element["style"] = {
    ...styleBase,
    ...(patch.color !== undefined ? { color: patch.color } : null),
  };
  return { transform, style };
}

// ─────────────────────────────────────────────────────────────
// Tree walker — renders a group as a Konva <Group> containing its
// children recursively. Top-level call uses parentId=null.
// ─────────────────────────────────────────────────────────────

function renderTree(
  sorted: Element[],
  selectedIds: string[],
  selectElement: (id: string, additive: boolean) => void,
  updateElement: (id: string, patch: Partial<Element>) => void,
  setDragState: (s: { id: string; transform: { x: number; y: number; width: number; height: number } } | null) => void,
  others: Array<{ id: string; transform: { x: number; y: number; width: number; height: number } }>,
  canvasWidth: number,
  canvasHeight: number,
  parentId: string | null,
): React.ReactNode[] {
  return sorted
    .filter((e) => (e.parentGroupId ?? null) === parentId)
    .map((el) => {
      if (el.elementType === "group") {
        return (
          <Group
            key={el.id}
            x={el.transform.x}
            y={el.transform.y}
            draggable
            onClick={(e: { evt?: { shiftKey?: boolean } }) =>
              selectElement(el.id, Boolean(e.evt?.shiftKey))
            }
            onDragEnd={(e: { target: { x: () => number; y: () => number } }) =>
              updateElement(el.id, {
                transform: { ...el.transform, x: e.target.x(), y: e.target.y() },
              } as Partial<Element>)
            }
          >
            {renderTree(sorted, selectedIds, selectElement, updateElement, setDragState, others, canvasWidth, canvasHeight, el.id)}
          </Group>
        );
      }
      return (
        <RenderedElement
          key={el.id}
          el={el}
          selected={selectedIds.includes(el.id)}
          onSelect={(shift) => selectElement(el.id, shift)}
          onMove={(x, y) =>
            updateElement(el.id, {
              transform: { ...el.transform, x, y },
            } as Partial<Element>)
          }
          onDragMove={(x, y) => {
            setDragState({
              id: el.id,
              transform: { x, y, width: el.transform.width, height: el.transform.height },
            });
          }}
          onDragEnd={(x, y) => {
            setDragState(null);
            updateElement(el.id, {
              transform: { ...el.transform, x, y },
            } as Partial<Element>);
          }}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          othersForSnap={others.filter((o) => o.id !== el.id)}
        />
      );
    });
}

/**
 * Wave 1A — canvas drawing surface.
 * Wave 1B — adds ellipse / line / polygon renderers + alignment guides.
 * Wave 1C — renderTree() nests children under Konva <Group> by parentGroupId.
 * Wave 2C (fix 2026-05-19) — auto-fit zoom: 1920×1080 canvas now scales to
 * fit the available viewport on mount and on resize (via ResizeObserver).
 * Without this the stage rendered at 1:1 and content placed at canvas
 * center (x=860 in a 1920px canvas) landed outside a ~700px viewport,
 * giving the user a "blank canvas" even when elements existed.
 *
 * Renders active scene's elements as react-konva nodes sorted by
 * zIndex. Drag-end commits the new transform to the zustand store;
 * click (or shift-click) sets selection.
 *
 * Alignment guides: during drag, 1px dashed pink lines snap dragged
 * element to edges/centers of other elements or the canvas itself
 * within 5px (guide) / 3px (snap) thresholds.
 */
export function CanvasStage() {
  const design = useBuilderStore((s) => s.design);
  const activeSceneId = useBuilderStore((s) => s.activeSceneId);
  const selectedIds = useBuilderStore((s) => s.selectedElementIds);
  const updateElement = useBuilderStore((s) => s.updateElement);
  const selectElement = useBuilderStore((s) => s.selectElement);

  const canvasW = design?.canvasWidth ?? 1920;
  const canvasH = design?.canvasHeight ?? 1080;

  const [dragState, setDragState] = useState<{
    id: string;
    transform: { x: number; y: number; width: number; height: number };
  } | null>(null);

  // Auto-fit zoom — observe the scroll-container size and pick a zoom
  // level so the entire 1920×1080 canvas fits inside (with a small
  // padding margin so handles/borders aren't clipped). Falls back to
  // store's `zoomLevel` ONLY if the user has explicitly set a zoom
  // (future user-controlled zoom UI not yet shipped — for now we use
  // fit-to-screen unconditionally).
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [autoZoom, setAutoZoom] = useState<number>(0);

  useEffect(() => {
    const node = scrollContainerRef.current;
    if (!node) return;
    const compute = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const padPx = 24;
      const z = Math.min(
        (rect.width - padPx) / canvasW,
        (rect.height - padPx) / canvasH,
      );
      if (z > 0 && Number.isFinite(z)) {
        setAutoZoom(z);
      }
    };
    compute();
    // ResizeObserver isn't defined in JSDOM — skip in that environment.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(compute);
    ro.observe(node);
    return () => ro.disconnect();
  }, [canvasW, canvasH]);

  const zoom = autoZoom > 0 ? autoZoom : 1;

  // Wave 1C — multi-element bounding-box transformer
  const transformerRef = useRef<unknown>(null);

  useEffect(() => {
    const tr = (transformerRef.current ?? null) as {
      nodes?: (n: unknown[]) => void;
      getLayer?: () => { batchDraw: () => void };
    } | null;
    if (!tr || !tr.nodes) return;
    if (selectedIds.length < 2) {
      tr.nodes([]);
      tr.getLayer?.().batchDraw();
      return;
    }
    const stage = (document.querySelector("canvas") as unknown as {
      __stage?: { findOne: (sel: string) => unknown };
    })?.__stage;
    if (!stage) return;
    const nodes = selectedIds
      .map((id) => stage.findOne(`#${id}`))
      .filter(Boolean);
    tr.nodes(nodes as unknown[]);
    tr.getLayer?.().batchDraw();
  }, [selectedIds]);

  const scene = design && activeSceneId
    ? design.scenes.find((s) => s.id === activeSceneId) ?? null
    : null;

  const others = scene
    ? scene.elements
        .filter((e) => dragState && e.id !== dragState.id)
        .map((e) => ({ id: e.id, transform: e.transform as { x: number; y: number; width: number; height: number } }))
    : [];

  const alignment = useAlignmentGuides(
    dragState?.id ?? null,
    dragState?.transform ?? null,
    others,
    { width: canvasW, height: canvasH },
  );

  if (!design || !activeSceneId) {
    return (
      <div
        ref={scrollContainerRef}
        data-testid="builder-canvas-stage"
        data-state="empty"
        className="flex h-full items-center justify-center text-white/30"
      >
        No scene loaded
      </div>
    );
  }

  if (!scene) return null;

  const sorted = [...scene.elements]
    .filter((e) => e.visible !== false)
    .sort((a, b) => a.zIndex - b.zIndex);

  const w = canvasW * zoom;
  const h = canvasH * zoom;

  return (
    <div
      ref={scrollContainerRef}
      data-testid="builder-canvas-stage"
      data-state="ready"
      data-zoom={zoom.toFixed(4)}
      className="flex h-full w-full items-center justify-center overflow-hidden"
    >
      <div
        data-testid="builder-canvas-stage-frame"
        style={{
          width: w,
          height: h,
          // Subtle checker so the operator sees the 1920x1080 canvas
          // edges against the surrounding workspace.
          backgroundColor: "#0a0a0a",
          backgroundImage:
            "linear-gradient(45deg, #141414 25%, transparent 25%), linear-gradient(-45deg, #141414 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #141414 75%), linear-gradient(-45deg, transparent 75%, #141414 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
          boxShadow: "0 0 0 1px rgba(107, 205, 6, 0.25)",
        }}
        className="relative"
      >
      <Stage
        width={w}
        height={h}
        scaleX={zoom}
        scaleY={zoom}
        onClick={(e: { evt: MouseEvent }) => {
          const state = useBuilderStore.getState();
          if (state.toolMode !== "pen") return;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const stage = (e as any).target.getStage?.() ?? (e as any).target;
          const pt: { x: number; y: number } | null = stage.getPointerPosition?.() ?? null;
          if (!pt) return;
          state.appendPenNode({
            x: pt.x / zoom,
            y: pt.y / zoom,
            ctrlInX: pt.x / zoom,
            ctrlInY: pt.y / zoom,
            ctrlOutX: pt.x / zoom,
            ctrlOutY: pt.y / zoom,
          });
        }}
      >
        <Layer>
          {renderTree(sorted, selectedIds, selectElement, updateElement, setDragState, others, design.canvasWidth, design.canvasHeight, null)}
          {selectedIds.length > 1 && (
            <Transformer
              ref={transformerRef as never}
              rotateEnabled={false}
              resizeEnabled={false}
              enabledAnchors={[]}
              data-konva-tag="Transformer"
            />
          )}
          {alignment.guides.map((g, i) =>
            g.kind === "v" ? (
              <KLine
                key={`g-${i}`}
                points={[g.pos, g.from, g.pos, g.to]}
                stroke="#fe036d"
                strokeWidth={1}
                dash={[4, 4]}
                listening={false}
              />
            ) : (
              <KLine
                key={`g-${i}`}
                points={[g.from, g.pos, g.to, g.pos]}
                stroke="#fe036d"
                strokeWidth={1}
                dash={[4, 4]}
                listening={false}
              />
            ),
          )}
        </Layer>
        <PathPenOverlay />
      </Stage>
      </div>
    </div>
  );
}

function RenderedElement({
  el,
  selected,
  onSelect,
  onMove,
  onDragMove,
  onDragEnd,
  canvasWidth,
  canvasHeight,
  othersForSnap,
}: {
  el: Element;
  selected: boolean;
  onSelect: (shift: boolean) => void;
  onMove: (x: number, y: number) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (x: number, y: number) => void;
  canvasWidth: number;
  canvasHeight: number;
  othersForSnap: Array<{ id: string; transform: { x: number; y: number; width: number; height: number } }>;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onClick = (e: { evt?: any }) => {
    onSelect(Boolean(e.evt?.shiftKey));
  };

  // Wave 3B (Task 14) — scrub preview overlay. When the timeline panel
  // is open and the cursor is set, the rendered transform / style come
  // from `interpolateAt` layered on top of the canonical fields. With
  // the panel closed the patch resolves to {} and we render statically.
  const scrubPatch = useScrubPreview(el);
  const { transform: t, style: s } = applyScrubPatch(el, scrubPatch);

  const handleDragMove = (e: { target: { x: () => number; y: () => number; position: (p: { x: number; y: number }) => void } }) => {
    const rawX = e.target.x();
    const rawY = e.target.y();
    onDragMove(rawX, rawY);
    const a = computeAlignmentGuides(
      { x: rawX, y: rawY, width: el.transform.width, height: el.transform.height },
      othersForSnap,
      { width: canvasWidth, height: canvasHeight },
    );
    if (a.snappedX !== rawX || a.snappedY !== rawY) {
      e.target.position({ x: a.snappedX, y: a.snappedY });
    }
  };

  const handleDragEnd = (e: { target: { x: () => number; y: () => number } }) => {
    onDragEnd(e.target.x(), e.target.y());
  };

  const stroke = selected ? "#6bcd06" : (s.stroke as string | undefined);
  const strokeWidth = selected ? 2 : ((s.strokeWidth as number | undefined) ?? 0);

  if (el.elementType === "rect") {
    return (
      <Rect
        id={el.id}
        x={t.x}
        y={t.y}
        width={t.width}
        height={t.height}
        rotation={t.rotation ?? 0}
        opacity={t.opacity ?? 1}
        fill={(s.fill as string) ?? "#cccccc"}
        stroke={stroke}
        strokeWidth={strokeWidth}
        cornerRadius={(s.cornerRadius as number) ?? 0}
        shadowColor={(s.shadow as { color?: string } | undefined)?.color}
        shadowBlur={(s.shadow as { blur?: number } | undefined)?.blur}
        shadowOffsetX={(s.shadow as { offsetX?: number } | undefined)?.offsetX}
        shadowOffsetY={(s.shadow as { offsetY?: number } | undefined)?.offsetY}
        draggable
        onClick={onClick}
        onTap={onClick}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
      />
    );
  }

  if (el.elementType === "text") {
    return (
      <Text
        id={el.id}
        x={t.x}
        y={t.y}
        width={t.width}
        height={t.height}
        rotation={t.rotation ?? 0}
        opacity={t.opacity ?? 1}
        text={(el.content?.text as string) ?? "Text"}
        fontFamily={(s.fontFamily as string) ?? "Agharti"}
        fontSize={(s.fontSize as number) ?? 32}
        fontStyle={(s.fontStyle as string) ?? "normal"}
        fill={(s.color as string) ?? "#ffffff"}
        draggable
        onClick={onClick}
        onTap={onClick}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
      />
    );
  }

  if (el.elementType === "image") {
    return (
      <RenderedImage
        el={el}
        t={t}
        stroke={stroke}
        strokeWidth={strokeWidth}
        onClick={onClick}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
      />
    );
  }

  if (el.elementType === "ellipse") {
    return (
      <Ellipse
        x={t.x + t.width / 2}
        y={t.y + t.height / 2}
        radiusX={t.width / 2}
        radiusY={t.height / 2}
        rotation={t.rotation ?? 0}
        opacity={t.opacity ?? 1}
        fill={(s.fill as string) ?? "#cccccc"}
        stroke={stroke}
        strokeWidth={strokeWidth}
        draggable
        onClick={onClick}
        onTap={onClick}
        onDragMove={(e: { target: { x: () => number; y: () => number; position: (p: { x: number; y: number }) => void } }) => {
          const rawX = e.target.x() - t.width / 2;
          const rawY = e.target.y() - t.height / 2;
          onDragMove(rawX, rawY);
          const a = computeAlignmentGuides(
            { x: rawX, y: rawY, width: t.width, height: t.height },
            othersForSnap,
            { width: canvasWidth, height: canvasHeight },
          );
          if (a.snappedX !== rawX || a.snappedY !== rawY) {
            e.target.position({ x: a.snappedX + t.width / 2, y: a.snappedY + t.height / 2 });
          }
        }}
        onDragEnd={(e: { target: { x: () => number; y: () => number } }) =>
          onDragEnd(e.target.x() - t.width / 2, e.target.y() - t.height / 2)
        }
      />
    );
  }

  if (el.elementType === "line") {
    return (
      <Line
        x={t.x}
        y={t.y}
        points={[0, 0, t.width, 0]}
        stroke={(s.stroke as string) ?? "#ffffff"}
        strokeWidth={(s.strokeWidth as number) ?? 2}
        rotation={t.rotation ?? 0}
        opacity={t.opacity ?? 1}
        draggable
        onClick={onClick}
        onTap={onClick}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
      />
    );
  }

  if (el.elementType === "polygon") {
    const sides = (s.sides as number) ?? 6;
    const radius = Math.min(t.width, t.height) / 2;
    return (
      <RegularPolygon
        x={t.x + t.width / 2}
        y={t.y + t.height / 2}
        sides={sides}
        radius={radius}
        rotation={t.rotation ?? 0}
        opacity={t.opacity ?? 1}
        fill={(s.fill as string) ?? "#cccccc"}
        stroke={stroke}
        strokeWidth={strokeWidth}
        draggable
        onClick={onClick}
        onTap={onClick}
        onDragMove={(e: { target: { x: () => number; y: () => number; position: (p: { x: number; y: number }) => void } }) => {
          const rawX = e.target.x() - t.width / 2;
          const rawY = e.target.y() - t.height / 2;
          onDragMove(rawX, rawY);
          const a = computeAlignmentGuides(
            { x: rawX, y: rawY, width: t.width, height: t.height },
            othersForSnap,
            { width: canvasWidth, height: canvasHeight },
          );
          if (a.snappedX !== rawX || a.snappedY !== rawY) {
            e.target.position({ x: a.snappedX + t.width / 2, y: a.snappedY + t.height / 2 });
          }
        }}
        onDragEnd={(e: { target: { x: () => number; y: () => number } }) =>
          onDragEnd(e.target.x() - t.width / 2, e.target.y() - t.height / 2)
        }
      />
    );
  }

  return null;
}

function RenderedImage({
  el,
  t,
  stroke,
  strokeWidth,
  onClick,
  onDragMove,
  onDragEnd,
}: {
  el: Element;
  t: Element["transform"];
  stroke?: string;
  strokeWidth: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onClick: (e: { evt?: any }) => void;
  onDragMove: (e: { target: { x: () => number; y: () => number; position: (p: { x: number; y: number }) => void } }) => void;
  onDragEnd: (e: { target: { x: () => number; y: () => number } }) => void;
}) {
  const url = (el.content?.assetUrl as string | undefined) ?? null;
  const img = useImage(url);
  return (
    <KImage
      id={el.id}
      x={t.x}
      y={t.y}
      width={t.width}
      height={t.height}
      rotation={t.rotation ?? 0}
      opacity={t.opacity ?? 1}
      image={img}
      stroke={stroke}
      strokeWidth={strokeWidth}
      draggable
      onClick={onClick}
      onTap={onClick}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
    />
  );
}
