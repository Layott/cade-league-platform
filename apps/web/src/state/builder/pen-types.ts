/**
 * Wave 1C — pen-tool shared types.
 *
 * PenDraftNode holds the anchor position plus its incoming/outgoing
 * Bezier control handles in canvas-space coordinates. When the draft
 * is finalised via completePenDraft the nodes are re-normalised to
 * element-local space (bounding-box top-left = origin).
 */
export type PenDraftNode = {
  x: number;
  y: number;
  ctrlInX: number;
  ctrlInY: number;
  ctrlOutX: number;
  ctrlOutY: number;
};
