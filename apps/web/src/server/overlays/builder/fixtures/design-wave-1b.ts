import type { Design } from "../types";

/**
 * Wave 1B compiler fixture — exercises gradient + filter + multi-shadow
 * + new shape types (ellipse / line / polygon) in a single render.
 *
 * Asserted by compiler.test.ts Wave 1B describe block.
 *
 * Note: uses camelCase field names matching the actual TypeScript schema
 * (sceneId, elementType, zIndex, scaleX, scaleY, etc.) not the DB snake_case.
 */
export const designWave1b: Design = {
  id: "00000000-0000-0000-0000-00000000ab01",
  slug: "fx-wave-1b",
  title: "Fixture: Wave 1B",
  description: null,
  mode: "single",
  status: "published",
  canvasWidth: 1920,
  canvasHeight: 1080,
  createdBy: "00000000-0000-0000-0000-000000000099",
  scenes: [
    {
      id: "00000000-0000-0000-0000-00000000ab10",
      designId: "00000000-0000-0000-0000-00000000ab01",
      orderIndex: 0,
      name: "main",
      durationMs: 5000,
      transitionIn: "fade",
      transitionOut: "fade",
      elements: [
        // 1) rect with linear gradient + multi-shadow + filter
        {
          id: "00000000-0000-0000-0000-00000000ab21",
          sceneId: "00000000-0000-0000-0000-00000000ab10",
          parentGroupId: null,
          elementType: "rect",
          zIndex: 0,
          locked: false,
          visible: true,
          transform: {
            x: 100, y: 100, width: 400, height: 200,
            rotation: 0, scaleX: 1, scaleY: 1, opacity: 1,
          },
          style: {
            gradient: {
              kind: "linear",
              angle: 90,
              stops: [
                { offset: 0, color: "#6bcd06" },
                { offset: 1, color: "#fe036d" },
              ],
            },
            shadows: [
              { offsetX: 4, offsetY: 4, blur: 12, color: "#000000", opacity: 0.5 },
              { offsetX: -4, offsetY: -4, blur: 12, color: "#6bcd06", opacity: 0.3 },
            ],
            filter: { blur: 0, brightness: 1.1, saturate: 1.2 },
          },
          content: {},
          binding: null,
          animation: {},
        },
        // 2) ellipse with radial gradient
        {
          id: "00000000-0000-0000-0000-00000000ab22",
          sceneId: "00000000-0000-0000-0000-00000000ab10",
          parentGroupId: null,
          elementType: "ellipse",
          zIndex: 1,
          locked: false,
          visible: true,
          transform: {
            x: 600, y: 100, width: 300, height: 300,
            rotation: 0, scaleX: 1, scaleY: 1, opacity: 1,
          },
          style: {
            gradient: {
              kind: "radial",
              cx: 0.5, cy: 0.5, radius: 0.7,
              stops: [
                { offset: 0, color: "#ffffff" },
                { offset: 1, color: "#050505" },
              ],
            },
          },
          content: {},
          binding: null,
          animation: {},
        },
        // 3) line — stroke only
        {
          id: "00000000-0000-0000-0000-00000000ab23",
          sceneId: "00000000-0000-0000-0000-00000000ab10",
          parentGroupId: null,
          elementType: "line",
          zIndex: 2,
          locked: false,
          visible: true,
          transform: {
            x: 100, y: 500, width: 800, height: 6,
            rotation: 0, scaleX: 1, scaleY: 1, opacity: 1,
          },
          style: {
            stroke: "#6bcd06",
            strokeWidth: 6,
          },
          content: {},
          binding: null,
          animation: {},
        },
        // 4) polygon — hexagon
        {
          id: "00000000-0000-0000-0000-00000000ab24",
          sceneId: "00000000-0000-0000-0000-00000000ab10",
          parentGroupId: null,
          elementType: "polygon",
          zIndex: 3,
          locked: false,
          visible: true,
          transform: {
            x: 1100, y: 100, width: 240, height: 240,
            rotation: 0, scaleX: 1, scaleY: 1, opacity: 1,
          },
          style: {
            fill: "#fe036d",
            sides: 6,
          },
          content: {},
          binding: null,
          animation: {},
        },
        // 5) text with gradient fill
        {
          id: "00000000-0000-0000-0000-00000000ab25",
          sceneId: "00000000-0000-0000-0000-00000000ab10",
          parentGroupId: null,
          elementType: "text",
          zIndex: 4,
          locked: false,
          visible: true,
          transform: {
            x: 100, y: 700, width: 1600, height: 160,
            rotation: 0, scaleX: 1, scaleY: 1, opacity: 1,
          },
          style: {
            fontFamily: "Agharti",
            fontSize: 96,
            fontWeight: 700,
            color: "#ffffff",
            gradient: {
              kind: "linear",
              angle: 45,
              stops: [
                { offset: 0, color: "#6bcd06" },
                { offset: 1, color: "#fe036d" },
              ],
            },
          },
          content: { text: "WAVE 1B" },
          binding: null,
          animation: {},
        },
      ],
    },
  ],
};
