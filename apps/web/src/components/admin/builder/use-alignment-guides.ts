"use client";

import { useMemo } from "react";

const PROXIMITY = 5;
const SNAP = 3;

export type Rect = { x: number; y: number; width: number; height: number };
export type Other = { id: string; transform: Rect };
export type Guide = {
  kind: "v" | "h";
  pos: number;
  from: number;
  to: number;
};
export type AlignmentResult = {
  guides: Guide[];
  snappedX: number;
  snappedY: number;
};

/**
 * Compute alignment guides + smart-snap during drag.
 *
 * Anchors compared (per axis):
 *   - Dragged left / center / right vs every other's left / center / right
 *   - Dragged top  / center / bottom vs every other's top / center / bottom
 *   - Canvas left / center / right; top / center / bottom.
 *
 * Within `PROXIMITY` px of a match, emit a guide line. Within `SNAP` px,
 * additionally snap the dragged x/y to the matched anchor (so dragged
 * center / edge coincides with the other anchor).
 *
 * Pure function — testable without DOM. The hook below wraps memoization.
 */
export function computeAlignmentGuides(
  dragged: Rect,
  others: Other[],
  canvas: { width: number; height: number },
): AlignmentResult {
  const guides: Guide[] = [];
  let snappedX = dragged.x;
  let snappedY = dragged.y;
  let bestX = Infinity;
  let bestY = Infinity;

  const draggedAnchors = {
    xLeft: dragged.x,
    xCenter: dragged.x + dragged.width / 2,
    xRight: dragged.x + dragged.width,
    yTop: dragged.y,
    yCenter: dragged.y + dragged.height / 2,
    yBottom: dragged.y + dragged.height,
  };

  function considerXMatch(otherX: number, fromY: number, toY: number) {
    // Try each dragged x-anchor against this other-x.
    for (const [name, value] of [
      ["xLeft", draggedAnchors.xLeft],
      ["xCenter", draggedAnchors.xCenter],
      ["xRight", draggedAnchors.xRight],
    ] as const) {
      const d = Math.abs(value - otherX);
      if (d <= PROXIMITY) {
        guides.push({ kind: "v", pos: otherX, from: fromY, to: toY });
      }
      if (d <= SNAP && d < bestX) {
        bestX = d;
        // shift dragged.x so this anchor lands exactly on otherX.
        if (name === "xLeft") snappedX = otherX;
        else if (name === "xCenter") snappedX = otherX - dragged.width / 2;
        else snappedX = otherX - dragged.width;
      }
    }
  }

  function considerYMatch(otherY: number, fromX: number, toX: number) {
    for (const [name, value] of [
      ["yTop", draggedAnchors.yTop],
      ["yCenter", draggedAnchors.yCenter],
      ["yBottom", draggedAnchors.yBottom],
    ] as const) {
      const d = Math.abs(value - otherY);
      if (d <= PROXIMITY) {
        guides.push({ kind: "h", pos: otherY, from: fromX, to: toX });
      }
      if (d <= SNAP && d < bestY) {
        bestY = d;
        if (name === "yTop") snappedY = otherY;
        else if (name === "yCenter") snappedY = otherY - dragged.height / 2;
        else snappedY = otherY - dragged.height;
      }
    }
  }

  // Other-element anchors.
  for (const o of others) {
    const t = o.transform;
    considerXMatch(t.x, 0, canvas.height);
    considerXMatch(t.x + t.width / 2, 0, canvas.height);
    considerXMatch(t.x + t.width, 0, canvas.height);
    considerYMatch(t.y, 0, canvas.width);
    considerYMatch(t.y + t.height / 2, 0, canvas.width);
    considerYMatch(t.y + t.height, 0, canvas.width);
  }

  // Canvas anchors.
  considerXMatch(0, 0, canvas.height);
  considerXMatch(canvas.width / 2, 0, canvas.height);
  considerXMatch(canvas.width, 0, canvas.height);
  considerYMatch(0, 0, canvas.width);
  considerYMatch(canvas.height / 2, 0, canvas.width);
  considerYMatch(canvas.height, 0, canvas.width);

  return { guides, snappedX, snappedY };
}

export function useAlignmentGuides(
  draggedId: string | null,
  draggedTransform: Rect | null,
  others: Other[],
  canvas: { width: number; height: number },
): AlignmentResult {
  return useMemo(() => {
    if (!draggedId || !draggedTransform) {
      return { guides: [], snappedX: 0, snappedY: 0 };
    }
    return computeAlignmentGuides(draggedTransform, others, canvas);
  }, [draggedId, draggedTransform, others, canvas]);
}
