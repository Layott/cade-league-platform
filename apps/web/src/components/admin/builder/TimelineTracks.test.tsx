import { describe, expect, it, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TimelineTracks } from "./TimelineTracks";
import { useBuilderStore } from "@/state/builder/store";
import type { Element, TimelineProperty } from "@/server/overlays/builder/types";

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

function makeTrack(
  property: TimelineProperty,
  keyframes: Array<{ id: string; timeMs: number; value: number | string }>,
) {
  return {
    property,
    keyframes: keyframes.map((k) => ({
      ...k,
      easingOut: null,
    })),
  };
}

function makeElement(overrides: Partial<Element> = {}): Element {
  return {
    id: "el-1",
    sceneId: "s1",
    parentGroupId: null,
    elementType: "text",
    zIndex: 0,
    locked: false,
    visible: true,
    transform: {
      x: 0,
      y: 0,
      width: 200,
      height: 60,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
    },
    style: {},
    content: { text: "Hello" },
    binding: null,
    animation: {
      entry: {
        type: "noop",
        durationMs: 1000,
        delayMs: 0,
        easing: "linear",
        advancedTimeline: [
          makeTrack("opacity", [
            { id: "kf-op-1", timeMs: 0, value: 0 },
            { id: "kf-op-2", timeMs: 1000, value: 1 },
          ]),
          makeTrack("x", [
            { id: "kf-x-1", timeMs: 0, value: -120 },
            { id: "kf-x-2", timeMs: 1000, value: 0 },
          ]),
        ],
      },
    },
    ...overrides,
  } as Element;
}

function makeDesign(element: Element) {
  return {
    id: "d1",
    slug: "t",
    title: "T",
    description: null,
    mode: "single" as const,
    status: "draft" as const,
    canvasWidth: 1920,
    canvasHeight: 1080,
    createdBy: "u1",
    scenes: [
      {
        id: "s1",
        designId: "d1",
        orderIndex: 0,
        name: null,
        durationMs: 5000,
        transitionIn: "fade",
        transitionOut: "fade",
        elements: [element],
      },
    ],
  };
}

/**
 * Reset the store between tests and seed a fresh design holding the
 * passed-in element. Keeps each test isolated from leaks across modules.
 */
function seed(element: Element) {
  useBuilderStore.setState({
    design: makeDesign(element),
    selectedElementIds: [element.id],
    activeSceneId: "s1",
    zoomLevel: 1,
    dirty: false,
    timelinePanelOpen: true,
    timelineCursorMs: {},
    selectedKeyframeId: null,
  });
}

/**
 * Stub the clickarea's bounding-rect so the px → ms math is deterministic
 * under jsdom. left=0 keeps the math clean: clientX == localX.
 */
function stubClickAreaRect(
  property: TimelineProperty,
  opts: { left?: number; width?: number } = {},
) {
  const left = opts.left ?? 0;
  const width = opts.width ?? 1000;
  const original = window.Element.prototype.getBoundingClientRect;
  window.Element.prototype.getBoundingClientRect =
    function getBoundingClientRect() {
      if (
        this instanceof HTMLElement &&
        this.getAttribute("data-testid") === `track-row-${property}-clickarea`
      ) {
        return {
          x: left,
          y: 0,
          left,
          right: left + width,
          top: 0,
          bottom: 28,
          width,
          height: 28,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return original.call(this);
    };
  return () => {
    window.Element.prototype.getBoundingClientRect = original;
  };
}

// ─────────────────────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────────────────────

describe("TimelineTracks — render", () => {
  beforeEach(() => {
    useBuilderStore.setState({
      design: null,
      selectedElementIds: [],
      activeSceneId: null,
      zoomLevel: 1,
      dirty: false,
      timelinePanelOpen: false,
      timelineCursorMs: {},
      selectedKeyframeId: null,
    });
  });

  it("renders one row per existing track + ghost rows for the rest", () => {
    const el = makeElement();
    seed(el);
    render(<TimelineTracks element={el} phase="entry" />);
    // Real tracks render
    expect(screen.getByTestId("track-row-opacity")).toBeTruthy();
    expect(screen.getByTestId("track-row-x")).toBeTruthy();
    // Ghost rows render at data-ghost="true"
    expect(
      screen.getByTestId("track-row-y").getAttribute("data-ghost"),
    ).toBe("true");
    expect(
      screen.getByTestId("track-row-rotation").getAttribute("data-ghost"),
    ).toBe("true");
    expect(
      screen.getByTestId("track-row-color").getAttribute("data-ghost"),
    ).toBe("true");
  });

  it("real tracks render data-ghost='false'", () => {
    const el = makeElement();
    seed(el);
    render(<TimelineTracks element={el} phase="entry" />);
    expect(
      screen.getByTestId("track-row-opacity").getAttribute("data-ghost"),
    ).toBe("false");
    expect(
      screen.getByTestId("track-row-x").getAttribute("data-ghost"),
    ).toBe("false");
  });

  it("renders one KeyframeNode per keyframe inside each track row", () => {
    const el = makeElement();
    seed(el);
    render(<TimelineTracks element={el} phase="entry" />);
    expect(screen.getByTestId("keyframe-node-kf-op-1")).toBeTruthy();
    expect(screen.getByTestId("keyframe-node-kf-op-2")).toBeTruthy();
    expect(screen.getByTestId("keyframe-node-kf-x-1")).toBeTruthy();
    expect(screen.getByTestId("keyframe-node-kf-x-2")).toBeTruthy();
  });

  it("renders a property-name label in each row's gutter", () => {
    const el = makeElement();
    seed(el);
    render(<TimelineTracks element={el} phase="entry" />);
    expect(
      screen.getByTestId("track-row-opacity-label").textContent,
    ).toContain("opacity");
    expect(
      screen.getByTestId("track-row-rotation-label").textContent,
    ).toContain("rotation");
  });

  it("renders the appropriate tracks when the phase prop switches", () => {
    const el = makeElement({
      animation: {
        entry: {
          type: "noop",
          durationMs: 1000,
          delayMs: 0,
          easing: "linear",
          advancedTimeline: [
            makeTrack("opacity", [
              { id: "e1", timeMs: 0, value: 0 },
              { id: "e2", timeMs: 1000, value: 1 },
            ]),
          ],
        },
        exit: {
          type: "noop",
          durationMs: 1000,
          delayMs: 0,
          easing: "linear",
          advancedTimeline: [
            makeTrack("rotation", [
              { id: "x1", timeMs: 0, value: 0 },
              { id: "x2", timeMs: 1000, value: 360 },
            ]),
          ],
        },
      },
    });
    seed(el);
    const { rerender } = render(
      <TimelineTracks element={el} phase="entry" />,
    );
    expect(
      screen.getByTestId("track-row-opacity").getAttribute("data-ghost"),
    ).toBe("false");
    expect(
      screen.getByTestId("track-row-rotation").getAttribute("data-ghost"),
    ).toBe("true");
    rerender(<TimelineTracks element={el} phase="exit" />);
    expect(
      screen.getByTestId("track-row-opacity").getAttribute("data-ghost"),
    ).toBe("true");
    expect(
      screen.getByTestId("track-row-rotation").getAttribute("data-ghost"),
    ).toBe("false");
  });
});

// ─────────────────────────────────────────────────────────────
// Click empty area → addKeyframe
// ─────────────────────────────────────────────────────────────

describe("TimelineTracks — add keyframe on empty-area click", () => {
  beforeEach(() => {
    useBuilderStore.setState({
      design: null,
      selectedElementIds: [],
      activeSceneId: null,
      zoomLevel: 1,
      dirty: false,
      timelinePanelOpen: false,
      timelineCursorMs: {},
      selectedKeyframeId: null,
    });
  });

  it("clicking empty space on an existing track adds a keyframe at the computed ms", () => {
    const el = makeElement();
    seed(el);
    const restore = stubClickAreaRect("opacity", { left: 0, width: 1000 });
    try {
      render(<TimelineTracks element={el} phase="entry" />);
      const area = screen.getByTestId("track-row-opacity-clickarea");
      // clientX=400 + pxPerSecond=100 → 4000ms — clamped to durationMs=1000
      fireEvent.click(area, { clientX: 400 });
      const next = useBuilderStore.getState().design;
      const track = next?.scenes[0].elements[0].animation?.entry?.advancedTimeline?.find(
        (t) => t.property === "opacity",
      );
      // Existing 2 keyframes + the new one
      expect(track?.keyframes.length).toBe(3);
      // The new keyframe lands at the clamped duration (1000ms)
      const added = track?.keyframes.find(
        (k) => k.id !== "kf-op-1" && k.id !== "kf-op-2",
      );
      expect(added?.timeMs).toBe(1000);
      expect(added?.value).toBe(1);
    } finally {
      restore();
    }
  });

  it("clicking inside the canvas range yields the expected ms (no clamp)", () => {
    const el = makeElement();
    seed(el);
    const restore = stubClickAreaRect("opacity", { left: 0, width: 1000 });
    try {
      render(<TimelineTracks element={el} phase="entry" />);
      const area = screen.getByTestId("track-row-opacity-clickarea");
      // clientX=50 @ 100 px/s = 500ms — inside [0, 1000]
      fireEvent.click(area, { clientX: 50 });
      const track = useBuilderStore
        .getState()
        .design?.scenes[0].elements[0].animation?.entry?.advancedTimeline?.find(
          (t) => t.property === "opacity",
        );
      expect(track?.keyframes.length).toBe(3);
      const added = track?.keyframes.find(
        (k) => k.id !== "kf-op-1" && k.id !== "kf-op-2",
      );
      expect(added?.timeMs).toBe(500);
    } finally {
      restore();
    }
  });

  it("clicking a ghost row seeds a new track + first keyframe at the clicked ms", () => {
    const el = makeElement();
    seed(el);
    const restore = stubClickAreaRect("y", { left: 0, width: 1000 });
    try {
      render(<TimelineTracks element={el} phase="entry" />);
      const area = screen.getByTestId("track-row-y-clickarea");
      fireEvent.click(area, { clientX: 75 });
      const tracks =
        useBuilderStore.getState().design?.scenes[0].elements[0].animation?.entry
          ?.advancedTimeline;
      const yTrack = tracks?.find((t) => t.property === "y");
      expect(yTrack).toBeDefined();
      expect(yTrack?.keyframes.length).toBe(1);
      expect(yTrack?.keyframes[0].timeMs).toBe(750);
      expect(yTrack?.keyframes[0].value).toBe(0);
    } finally {
      restore();
    }
  });

  it("ignores clicks that bubble from a child (target !== currentTarget)", () => {
    const el = makeElement();
    seed(el);
    const restore = stubClickAreaRect("opacity", { left: 0, width: 1000 });
    try {
      render(<TimelineTracks element={el} phase="entry" />);
      const before = useBuilderStore
        .getState()
        .design?.scenes[0].elements[0].animation?.entry?.advancedTimeline?.find(
          (t) => t.property === "opacity",
        )?.keyframes.length;
      // Click a child node (KeyframeNode) — its mousedown stops
      // propagation, but emulate a stray bubbled click to ensure the
      // empty-area handler still no-ops.
      const node = screen.getByTestId("keyframe-node-kf-op-1");
      fireEvent.click(node);
      const after = useBuilderStore
        .getState()
        .design?.scenes[0].elements[0].animation?.entry?.advancedTimeline?.find(
          (t) => t.property === "opacity",
        )?.keyframes.length;
      expect(after).toBe(before);
    } finally {
      restore();
    }
  });
});

// ─────────────────────────────────────────────────────────────
// Click keyframe → selectKeyframe
// ─────────────────────────────────────────────────────────────

describe("TimelineTracks — keyframe selection", () => {
  beforeEach(() => {
    useBuilderStore.setState({
      design: null,
      selectedElementIds: [],
      activeSceneId: null,
      zoomLevel: 1,
      dirty: false,
      timelinePanelOpen: false,
      timelineCursorMs: {},
      selectedKeyframeId: null,
    });
  });

  it("mousedown on a KeyframeNode writes the id into selectedKeyframeId", () => {
    const el = makeElement();
    seed(el);
    render(<TimelineTracks element={el} phase="entry" />);
    fireEvent.mouseDown(screen.getByTestId("keyframe-node-kf-x-1"));
    expect(useBuilderStore.getState().selectedKeyframeId).toBe("kf-x-1");
    fireEvent.mouseDown(screen.getByTestId("keyframe-node-kf-op-2"));
    expect(useBuilderStore.getState().selectedKeyframeId).toBe("kf-op-2");
  });

  it("renders the selected KeyframeNode with data-selected='true'", () => {
    const el = makeElement();
    seed(el);
    useBuilderStore.setState({ selectedKeyframeId: "kf-op-1" });
    render(<TimelineTracks element={el} phase="entry" />);
    expect(
      screen.getByTestId("keyframe-node-kf-op-1").getAttribute("data-selected"),
    ).toBe("true");
    expect(
      screen.getByTestId("keyframe-node-kf-op-2").getAttribute("data-selected"),
    ).toBe("false");
  });
});

// ─────────────────────────────────────────────────────────────
// Drag keyframe → updateKeyframe
// ─────────────────────────────────────────────────────────────

describe("TimelineTracks — drag keyframe", () => {
  beforeEach(() => {
    useBuilderStore.setState({
      design: null,
      selectedElementIds: [],
      activeSceneId: null,
      zoomLevel: 1,
      dirty: false,
      timelinePanelOpen: false,
      timelineCursorMs: {},
      selectedKeyframeId: null,
    });
  });

  it("dragging a KeyframeNode updates its timeMs in the store", () => {
    const el = makeElement();
    seed(el);
    render(<TimelineTracks element={el} phase="entry" />);
    // KeyframeNode falls back to clientX-delta when containerRect is null
    // (jsdom returns zeros — our component captures the rect at mount,
    // which will be all-zero in jsdom, so the rect path computes
    // localX = clientX - 0 == clientX). Either path leads to the same
    // expected ms below.
    const node = screen.getByTestId("keyframe-node-kf-op-1");
    fireEvent.mouseDown(node, { clientX: 0 });
    fireEvent.mouseMove(window, { clientX: 30 });
    const track = useBuilderStore
      .getState()
      .design?.scenes[0].elements[0].animation?.entry?.advancedTimeline?.find(
        (t) => t.property === "opacity",
      );
    const moved = track?.keyframes.find((k) => k.id === "kf-op-1");
    // 30px @ 100 px/s = 300ms
    expect(moved?.timeMs).toBe(300);
    fireEvent.mouseUp(window);
  });
});

// ─────────────────────────────────────────────────────────────
// Delete-key → removeKeyframe
// ─────────────────────────────────────────────────────────────

describe("TimelineTracks — delete keyframe via keyboard", () => {
  beforeEach(() => {
    useBuilderStore.setState({
      design: null,
      selectedElementIds: [],
      activeSceneId: null,
      zoomLevel: 1,
      dirty: false,
      timelinePanelOpen: false,
      timelineCursorMs: {},
      selectedKeyframeId: null,
    });
  });

  it("Delete key on a row whose track owns selectedKeyframeId removes it", () => {
    // Seed a 3-keyframe track so removal doesn't collapse the track
    // (schema floor is 2 — removeKeyframe collapses below floor).
    const el = makeElement({
      animation: {
        entry: {
          type: "noop",
          durationMs: 1000,
          delayMs: 0,
          easing: "linear",
          advancedTimeline: [
            makeTrack("opacity", [
              { id: "a", timeMs: 0, value: 0 },
              { id: "b", timeMs: 500, value: 0.5 },
              { id: "c", timeMs: 1000, value: 1 },
            ]),
          ],
        },
      },
    });
    seed(el);
    useBuilderStore.setState({ selectedKeyframeId: "b" });
    render(<TimelineTracks element={el} phase="entry" />);
    const row = screen.getByTestId("track-row-opacity");
    fireEvent.keyDown(row, { key: "Delete" });
    const track = useBuilderStore
      .getState()
      .design?.scenes[0].elements[0].animation?.entry?.advancedTimeline?.find(
        (t) => t.property === "opacity",
      );
    expect(track?.keyframes.map((k) => k.id)).toEqual(["a", "c"]);
    expect(useBuilderStore.getState().selectedKeyframeId).toBeNull();
  });

  it("Backspace also triggers removal (parity with Delete)", () => {
    const el = makeElement({
      animation: {
        entry: {
          type: "noop",
          durationMs: 1000,
          delayMs: 0,
          easing: "linear",
          advancedTimeline: [
            makeTrack("opacity", [
              { id: "a", timeMs: 0, value: 0 },
              { id: "b", timeMs: 500, value: 0.5 },
              { id: "c", timeMs: 1000, value: 1 },
            ]),
          ],
        },
      },
    });
    seed(el);
    useBuilderStore.setState({ selectedKeyframeId: "b" });
    render(<TimelineTracks element={el} phase="entry" />);
    const row = screen.getByTestId("track-row-opacity");
    fireEvent.keyDown(row, { key: "Backspace" });
    const track = useBuilderStore
      .getState()
      .design?.scenes[0].elements[0].animation?.entry?.advancedTimeline?.find(
        (t) => t.property === "opacity",
      );
    expect(track?.keyframes.map((k) => k.id)).toEqual(["a", "c"]);
  });

  it("Delete is a no-op when the selected keyframe is on a different row", () => {
    const el = makeElement();
    seed(el);
    // Select a keyframe on the X track, then hit Delete on the opacity row.
    useBuilderStore.setState({ selectedKeyframeId: "kf-x-1" });
    render(<TimelineTracks element={el} phase="entry" />);
    const opacityRow = screen.getByTestId("track-row-opacity");
    fireEvent.keyDown(opacityRow, { key: "Delete" });
    const tracks =
      useBuilderStore.getState().design?.scenes[0].elements[0].animation?.entry
        ?.advancedTimeline;
    expect(
      tracks?.find((t) => t.property === "x")?.keyframes.length,
    ).toBe(2);
    expect(useBuilderStore.getState().selectedKeyframeId).toBe("kf-x-1");
  });

  it("Delete is a no-op when no keyframe is selected", () => {
    const el = makeElement();
    seed(el);
    render(<TimelineTracks element={el} phase="entry" />);
    const row = screen.getByTestId("track-row-opacity");
    fireEvent.keyDown(row, { key: "Delete" });
    const tracks =
      useBuilderStore.getState().design?.scenes[0].elements[0].animation?.entry
        ?.advancedTimeline;
    expect(
      tracks?.find((t) => t.property === "opacity")?.keyframes.length,
    ).toBe(2);
  });
});
