"use client";

import { useState } from "react";
import { Stage, Layer, Rect, Text, Image as KImage, Ellipse, Line, RegularPolygon, Line as KLine } from "react-konva";
import { useBuilderStore } from "@/state/builder/store";
import { useImage } from "./useImage";
import type { Element } from "@/server/overlays/builder/types";
import { useAlignmentGuides, computeAlignmentGuides } from "./use-alignment-guides";

/**
 * Wave 1A — canvas drawing surface.
 * Wave 1B — adds ellipse / line / polygon renderers + alignment guides.
 *
 * Renders active scene's elements as react-konva nodes sorted by
 * zIndex. Drag-end commits the new transform to the zustand store;
 * click (or shift-click) sets selection. Container scrolls if window
 * smaller than canvas — pan/zoom polish deferred.
 *
 * Alignment guides: during drag, 1px dashed pink lines snap dragged
 * element to edges/centers of other elements or the canvas itself
 * within 5px (guide) / 3px (snap) thresholds.
 */
export function CanvasStage() {
  const design = useBuilderStore((s) => s.design);
  const activeSceneId = useBuilderStore((s) => s.activeSceneId);
  const zoom = useBuilderStore((s) => s.zoomLevel);
  const selectedIds = useBuilderStore((s) => s.selectedElementIds);
  const updateElement = useBuilderStore((s) => s.updateElement);
  const selectElement = useBuilderStore((s) => s.selectElement);

  const [dragState, setDragState] = useState<{
    id: string;
    transform: { x: number; y: number; width: number; height: number };
  } | null>(null);

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
    { width: design?.canvasWidth ?? 1920, height: design?.canvasHeight ?? 1080 },
  );

  if (!design || !activeSceneId) {
    return (
      <div className="flex h-full items-center justify-center text-white/30">
        No scene loaded
      </div>
    );
  }

  if (!scene) return null;

  const sorted = [...scene.elements]
    .filter((e) => e.visible !== false)
    .sort((a, b) => a.zIndex - b.zIndex);

  const w = design.canvasWidth * zoom;
  const h = design.canvasHeight * zoom;

  return (
    <div className="overflow-auto">
      <Stage width={w} height={h} scaleX={zoom} scaleY={zoom}>
        <Layer>
          {sorted.map((el) => (
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
              canvasWidth={design.canvasWidth}
              canvasHeight={design.canvasHeight}
              othersForSnap={others.filter((o) => o.id !== el.id)}
            />
          ))}
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
      </Stage>
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

  const t = el.transform;
  const s = el.style ?? {};
  const stroke = selected ? "#6bcd06" : (s.stroke as string | undefined);
  const strokeWidth = selected ? 2 : ((s.strokeWidth as number | undefined) ?? 0);

  if (el.elementType === "rect") {
    return (
      <Rect
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
