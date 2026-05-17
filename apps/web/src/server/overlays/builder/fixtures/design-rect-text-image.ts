import type { Design } from "../types";

/**
 * Minimal hand-built design used by compiler.test.ts:
 *   - 1 rect element (green background, top-left corner)
 *   - 1 text element with hardcoded content "HELLO"
 *   - 1 image element pointing at an uploaded asset (no binding)
 *
 * All elements share a single scene. No animations, no bindings —
 * exercises the bare §14 contract.
 */
export const designRectTextImage: Design = {
  id: "00000000-0000-0000-0000-000000000001",
  slug: "fx-rect-text-image",
  title: "Fixture: rect + text + image",
  description: null,
  mode: "single",
  status: "published",
  canvasWidth: 1920,
  canvasHeight: 1080,
  createdBy: "00000000-0000-0000-0000-000000000099",
  scenes: [
    {
      id: "00000000-0000-0000-0000-000000000010",
      designId: "00000000-0000-0000-0000-000000000001",
      orderIndex: 0,
      name: "main",
      durationMs: 5000,
      transitionIn: "fade",
      transitionOut: "fade",
      elements: [
        {
          id: "00000000-0000-0000-0000-000000000100",
          sceneId: "00000000-0000-0000-0000-000000000010",
          parentGroupId: null,
          elementType: "rect",
          zIndex: 0,
          locked: false,
          visible: true,
          transform: {
            x: 100,
            y: 200,
            width: 400,
            height: 200,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            opacity: 1,
          },
          style: {
            fill: "#6bcd06",
          },
          content: {},
          binding: null,
          animation: {},
        },
        {
          id: "00000000-0000-0000-0000-000000000101",
          sceneId: "00000000-0000-0000-0000-000000000010",
          parentGroupId: null,
          elementType: "text",
          zIndex: 1,
          locked: false,
          visible: true,
          transform: {
            x: 600,
            y: 300,
            width: 600,
            height: 80,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            opacity: 1,
          },
          style: {
            fill: "#ffffff",
            fontFamily: "Agharti",
            fontSize: 64,
            fontWeight: 700,
            textAlign: "left",
          },
          content: { text: "HELLO" },
          binding: null,
          animation: {},
        },
        {
          id: "00000000-0000-0000-0000-000000000102",
          sceneId: "00000000-0000-0000-0000-000000000010",
          parentGroupId: null,
          elementType: "image",
          zIndex: 2,
          locked: false,
          visible: true,
          transform: {
            x: 1300,
            y: 200,
            width: 400,
            height: 400,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            opacity: 1,
          },
          style: {},
          content: { asset_path: "image/logo-test.png" },
          binding: null,
          animation: {},
        },
      ],
    },
  ],
};
