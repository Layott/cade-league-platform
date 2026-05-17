import type { Design } from "../types";

/**
 * Single rect with slide-left entry animation. Exercises @keyframes
 * emit path + per-element animation rule.
 */
export const designWithAnimation: Design = {
  id: "00000000-0000-0000-0000-000000000003",
  slug: "fx-animation-slide-left",
  title: "Fixture: slide-left entry",
  description: null,
  mode: "single",
  status: "published",
  canvasWidth: 1920,
  canvasHeight: 1080,
  createdBy: "00000000-0000-0000-0000-000000000099",
  scenes: [
    {
      id: "00000000-0000-0000-0000-000000000030",
      designId: "00000000-0000-0000-0000-000000000003",
      orderIndex: 0,
      name: "main",
      durationMs: 5000,
      transitionIn: "fade",
      transitionOut: "fade",
      elements: [
        {
          id: "00000000-0000-0000-0000-000000000300",
          sceneId: "00000000-0000-0000-0000-000000000030",
          parentGroupId: null,
          elementType: "rect",
          zIndex: 0,
          locked: false,
          visible: true,
          transform: {
            x: 400,
            y: 400,
            width: 300,
            height: 300,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            opacity: 1,
          },
          style: {
            fill: "#fe036d",
          },
          content: {},
          binding: null,
          animation: {
            entry: {
              type: "slide-left",
              durationMs: 600,
              delayMs: 0,
              easing: "ease-out",
            },
          },
        },
      ],
    },
  ],
};
