import type { Design } from "../types";

/**
 * Wave 3A fixture: sequence-mode design with 3 scenes.
 *
 *   Scene 1 (5s, fade in / slide-left out) — single rect.
 *   Scene 2 (3s, slide-left in / slide-up out) — text "MIDDLE".
 *   Scene 3 (4s, slide-up in / fade out) — image.
 *
 * Note: uses camelCase field names matching the runtime TypeScript schema
 * (durationMs, transitionIn/Out, sceneId, parentGroupId, elementType, zIndex,
 * scaleX/Y) not the DB snake_case. The plan body's snake_case is the DB
 * shape; the compiler reads the runtime camelCase shape.
 */
export const designSequence3Scenes: Design = {
  id: "00000000-0000-0000-0000-000000000700",
  slug: "fx-sequence-3-scenes",
  title: "Fixture: 3 sequence scenes",
  description: null,
  mode: "sequence",
  status: "published",
  canvasWidth: 1920,
  canvasHeight: 1080,
  createdBy: "00000000-0000-0000-0000-000000000099",
  scenes: [
    {
      id: "00000000-0000-0000-0000-000000000701",
      designId: "00000000-0000-0000-0000-000000000700",
      orderIndex: 0,
      name: "intro",
      durationMs: 5000,
      transitionIn: "fade",
      transitionOut: "slide-left",
      elements: [
        {
          id: "00000000-0000-0000-0000-000000000801",
          sceneId: "00000000-0000-0000-0000-000000000701",
          parentGroupId: null,
          elementType: "rect",
          zIndex: 0,
          locked: false,
          visible: true,
          transform: {
            x: 100,
            y: 100,
            width: 300,
            height: 200,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            opacity: 1,
          },
          style: { fill: "#6bcd06" },
          content: {},
          binding: null,
          animation: {},
        },
      ],
    },
    {
      id: "00000000-0000-0000-0000-000000000702",
      designId: "00000000-0000-0000-0000-000000000700",
      orderIndex: 1,
      name: "main",
      durationMs: 3000,
      transitionIn: "slide-left",
      transitionOut: "slide-up",
      elements: [
        {
          id: "00000000-0000-0000-0000-000000000802",
          sceneId: "00000000-0000-0000-0000-000000000702",
          parentGroupId: null,
          elementType: "text",
          zIndex: 0,
          locked: false,
          visible: true,
          transform: {
            x: 200,
            y: 400,
            width: 800,
            height: 120,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            opacity: 1,
          },
          style: { fontFamily: "Agharti", fontSize: 96, fill: "#ffffff" },
          content: { text: "MIDDLE" },
          binding: null,
          animation: {},
        },
      ],
    },
    {
      id: "00000000-0000-0000-0000-000000000703",
      designId: "00000000-0000-0000-0000-000000000700",
      orderIndex: 2,
      name: "outro",
      durationMs: 4000,
      transitionIn: "slide-up",
      transitionOut: "fade",
      elements: [
        {
          id: "00000000-0000-0000-0000-000000000803",
          sceneId: "00000000-0000-0000-0000-000000000703",
          parentGroupId: null,
          elementType: "image",
          zIndex: 0,
          locked: false,
          visible: true,
          transform: {
            x: 760,
            y: 400,
            width: 400,
            height: 200,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            opacity: 1,
          },
          style: {},
          content: { asset_path: "image/logo-outro.png" },
          binding: null,
          animation: {},
        },
      ],
    },
  ],
};
