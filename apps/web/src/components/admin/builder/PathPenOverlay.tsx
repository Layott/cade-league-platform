"use client";

import { useEffect } from "react";
import { Layer, Circle, Line, Group } from "react-konva";
import { useBuilderStore } from "@/state/builder/store";

/**
 * Wave 1C — pen-tool overlay layer.
 *
 * Mounts above the main CanvasStage layer. While toolMode === "pen":
 *   - Click adds an anchor node at the pointer (mirrored control points
 *     equal to the anchor so the segment defaults to straight).
 *   - Esc cancels the draft, Enter completes it (≥2 nodes required).
 *
 * The component itself renders draft anchors + the in-flight dashed-line
 * preview. Pointer capture lives on CanvasStage's Stage onClick which
 * calls appendPenNode when toolMode === "pen".
 */
export function PathPenOverlay() {
  const toolMode = useBuilderStore((s) => s.toolMode);
  const penDraft = useBuilderStore((s) => s.penDraft);
  const activeSceneId = useBuilderStore((s) => s.activeSceneId);
  const completePenDraft = useBuilderStore((s) => s.completePenDraft);
  const cancelPenDraft = useBuilderStore((s) => s.cancelPenDraft);

  // Esc cancels; Enter completes.
  useEffect(() => {
    if (toolMode !== "pen") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelPenDraft();
      } else if (e.key === "Enter" && penDraft && penDraft.nodes.length >= 2 && activeSceneId) {
        e.preventDefault();
        const xs = penDraft.nodes.map((n) => n.x);
        const ys = penDraft.nodes.map((n) => n.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs);
        const maxY = Math.max(...ys);
        completePenDraft(activeSceneId, {
          x: minX,
          y: minY,
          width: Math.max(1, maxX - minX),
          height: Math.max(1, maxY - minY),
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          opacity: 1,
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toolMode, penDraft, activeSceneId, completePenDraft, cancelPenDraft]);

  if (toolMode !== "pen") return null;
  const nodes = penDraft?.nodes ?? [];

  const linePoints: number[] = nodes.flatMap((n) => [n.x, n.y]);

  return (
    <Layer listening={false}>
      <Line points={linePoints} stroke="#6bcd06" strokeWidth={1} dash={[6, 6]} />
      <Group>
        {nodes.map((n, i) => (
          <Circle
            key={`pen-anchor-${i}`}
            x={n.x}
            y={n.y}
            radius={4}
            fill="#050505"
            stroke="#6bcd06"
            strokeWidth={2}
            data-anchor="true"
          />
        ))}
      </Group>
    </Layer>
  );
}
