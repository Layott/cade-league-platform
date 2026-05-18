import type { Design } from "../types";

/**
 * Single path element — a downward-facing triangle drawn from three
 * straight anchor nodes. Exercises the compiler's <svg><path d=...>
 * emit path + style fill / stroke wiring.
 */
export const designWithPath: Design = {
  id: "00000000-0000-0000-0000-000000000004",
  slug: "fx-path-triangle",
  title: "Fixture: path triangle",
  description: null,
  mode: "single",
  status: "published",
  canvasWidth: 1920,
  canvasHeight: 1080,
  createdBy: "00000000-0000-0000-0000-000000000099",
  scenes: [
    {
      id: "00000000-0000-0000-0000-000000000040",
      designId: "00000000-0000-0000-0000-000000000004",
      orderIndex: 0,
      name: "main",
      durationMs: 5000,
      transitionIn: "fade",
      transitionOut: "fade",
      elements: [
        {
          id: "00000000-0000-0000-0000-000000000400",
          sceneId: "00000000-0000-0000-0000-000000000040",
          parentGroupId: null,
          elementType: "path",
          zIndex: 0,
          locked: false,
          visible: true,
          transform: {
            x: 200, y: 200, width: 400, height: 400,
            rotation: 0, scaleX: 1, scaleY: 1, opacity: 1,
          },
          style: { fill: "#6bcd06", stroke: "#050505", strokeWidth: 4 },
          content: {
            path: {
              nodes: [
                // Apex — ctrlOut has a handle, making the first segment a cubic Bezier.
                { x: 200, y: 0, ctrlInX: 200, ctrlInY: 0, ctrlOutX: 250, ctrlOutY: 50 },
                // Bottom-right — straight after this node (ctrlOut = anchor).
                { x: 400, y: 400, ctrlInX: 350, ctrlInY: 350, ctrlOutX: 400, ctrlOutY: 400 },
                // Bottom-left — straight.
                { x: 0, y: 400, ctrlInX: 0, ctrlInY: 400, ctrlOutX: 0, ctrlOutY: 400 },
              ],
              closed: true,
            },
          },
          binding: null,
          animation: {},
        },
      ],
    },
  ],
};
