import type { Design } from "../types";

/**
 * Wave 3B fixture: single text element with a 3-keyframe advanced
 * opacity track + a 2-keyframe x track. Exercises the Wave 3B compiler
 * branch:
 *   - 0%   opacity:0  x:-120
 *   - 50%  opacity:1
 *   - 100% opacity:0.4  x:0
 *
 * Phase entry duration 1000ms. Bezier easing on first segment of x.
 *
 * Note: uses camelCase field names matching the runtime TypeScript
 * schema (durationMs, transitionIn/Out, sceneId, parentGroupId,
 * elementType, zIndex, scaleX/Y) — the plan body's snake_case is the
 * DB shape; the compiler reads the runtime camelCase shape.
 */
export const designWithAdvancedTimeline: Design = {
  id: "00000000-0000-0000-0000-000000003001",
  slug: "fx-advanced-timeline",
  title: "Fixture: advanced timeline",
  description: null,
  mode: "single",
  status: "published",
  canvasWidth: 1920,
  canvasHeight: 1080,
  createdBy: "00000000-0000-0000-0000-000000000099",
  scenes: [
    {
      id: "00000000-0000-0000-0000-000000003010",
      designId: "00000000-0000-0000-0000-000000003001",
      orderIndex: 0,
      name: "main",
      durationMs: 5000,
      transitionIn: "fade",
      transitionOut: "fade",
      elements: [
        {
          id: "00000000-0000-0000-0000-000000003100",
          sceneId: "00000000-0000-0000-0000-000000003010",
          parentGroupId: null,
          elementType: "text",
          zIndex: 0,
          locked: false,
          visible: true,
          transform: {
            x: 400,
            y: 400,
            width: 1000,
            height: 100,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            opacity: 1,
          },
          style: {
            fill: "#ffffff",
            fontFamily: "Agharti",
            fontSize: 72,
            fontWeight: 700,
            textAlign: "left",
          },
          content: { text: "ADVANCED" },
          binding: null,
          animation: {
            entry: {
              type: "noop",
              durationMs: 1000,
              delayMs: 0,
              easing: "linear",
              advancedTimeline: [
                {
                  property: "opacity",
                  keyframes: [
                    { id: "o1", timeMs: 0, value: 0, easingOut: null },
                    { id: "o2", timeMs: 500, value: 1, easingOut: null },
                    { id: "o3", timeMs: 1000, value: 0.4, easingOut: null },
                  ],
                },
                {
                  property: "x",
                  keyframes: [
                    {
                      id: "x1",
                      timeMs: 0,
                      value: -120,
                      easingOut: { x1: 0.4, y1: 0, x2: 0.6, y2: 1 },
                    },
                    { id: "x2", timeMs: 1000, value: 0, easingOut: null },
                  ],
                },
              ],
            },
          },
        },
      ],
    },
  ],
};
