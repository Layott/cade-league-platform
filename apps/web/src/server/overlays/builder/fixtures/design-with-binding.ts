import type { Design } from "../types";

/**
 * Single text element bound to standings rank-1 player name.
 * Exercises the data-binding emit path: data-binding-* attrs on the DOM
 * node + __OVERLAY_FEEDS__ injection at top of body.
 */
export const designWithBinding: Design = {
  id: "00000000-0000-0000-0000-000000000002",
  slug: "fx-binding-standings",
  title: "Fixture: standings binding",
  description: null,
  mode: "single",
  status: "published",
  canvasWidth: 1920,
  canvasHeight: 1080,
  createdBy: "00000000-0000-0000-0000-000000000099",
  scenes: [
    {
      id: "00000000-0000-0000-0000-000000000020",
      designId: "00000000-0000-0000-0000-000000000002",
      orderIndex: 0,
      name: "main",
      durationMs: 5000,
      transitionIn: "fade",
      transitionOut: "fade",
      elements: [
        {
          id: "00000000-0000-0000-0000-000000000200",
          sceneId: "00000000-0000-0000-0000-000000000020",
          parentGroupId: null,
          elementType: "text",
          zIndex: 0,
          locked: false,
          visible: true,
          transform: {
            x: 200,
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
          content: { text: "--" },
          binding: {
            feed: "standings",
            fieldPath: "standings[0].name",
            templateString: "${standings[0].name}",
          },
          animation: {},
        },
      ],
    },
  ],
};
