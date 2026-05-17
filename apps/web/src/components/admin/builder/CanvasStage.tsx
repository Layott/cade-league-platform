"use client";

import { Stage, Layer, Rect, Text, Image as KImage } from "react-konva";
import { useBuilderStore } from "@/state/builder/store";
import { useImage } from "./useImage";
import type { Element } from "@/server/overlays/builder/types";

/**
 * Wave 1A — canvas drawing surface.
 *
 * Renders active scene's elements as react-konva nodes sorted by
 * zIndex. Drag-end commits the new transform to the zustand store;
 * click (or shift-click) sets selection. Container scrolls if window
 * smaller than canvas — pan/zoom polish deferred.
 */
export function CanvasStage() {
  const design = useBuilderStore((s) => s.design);
  const activeSceneId = useBuilderStore((s) => s.activeSceneId);
  const zoom = useBuilderStore((s) => s.zoomLevel);
  const selectedIds = useBuilderStore((s) => s.selectedElementIds);
  const updateElement = useBuilderStore((s) => s.updateElement);
  const selectElement = useBuilderStore((s) => s.selectElement);

  if (!design || !activeSceneId) {
    return (
      <div className="flex h-full items-center justify-center text-white/30">
        No scene loaded
      </div>
    );
  }

  const scene = design.scenes.find((s) => s.id === activeSceneId);
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
            />
          ))}
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
}: {
  el: Element;
  selected: boolean;
  onSelect: (shift: boolean) => void;
  onMove: (x: number, y: number) => void;
}) {
  const handleDragEnd = (e: { target: { x: () => number; y: () => number } }) => {
    onMove(e.target.x(), e.target.y());
  };
  const onClick = (e: { evt?: { shiftKey?: boolean } }) => {
    onSelect(Boolean(e.evt?.shiftKey));
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
        onDragEnd={handleDragEnd}
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
  onDragEnd,
}: {
  el: Element;
  t: Element["transform"];
  stroke?: string;
  strokeWidth: number;
  onClick: (e: { evt?: { shiftKey?: boolean } }) => void;
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
      onDragEnd={onDragEnd}
    />
  );
}
