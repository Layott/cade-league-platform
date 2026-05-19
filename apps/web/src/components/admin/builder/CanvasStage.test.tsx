import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { CanvasStage } from "./CanvasStage";
import { useBuilderStore } from "@/state/builder/store";

// Mock react-konva so the test can render in jsdom without a real canvas.
vi.mock("react-konva", async () => {
  const React = await import("react");
  const make = (tag: string) => {
    const C = React.forwardRef((props: Record<string, unknown>, ref: unknown) =>
      React.createElement(
        "div",
        { ...props, ref, "data-konva-tag": tag, role: tag === "Stage" ? "img" : undefined },
        props.children as React.ReactNode,
      ),
    );
    C.displayName = `Konva${tag}`;
    return C;
  };
  return {
    Stage: make("Stage"),
    Layer: make("Layer"),
    Rect: make("Rect"),
    Text: make("Text"),
    Image: make("Image"),
    Ellipse: make("Ellipse"),
    Line: make("Line"),
    RegularPolygon: make("RegularPolygon"),
    Group: make("Group"),
    Transformer: make("Transformer"),
  };
});

const fixture = () => ({
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
      elements: [
        {
          id: "e1",
          sceneId: "s1",
          parentGroupId: null,
          elementType: "rect" as const,
          zIndex: 0,
          locked: false,
          visible: true,
          transform: { x: 10, y: 10, width: 100, height: 50, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
          style: { fill: "#fe036d" },
          content: {},
          binding: null,
          animation: {},
        },
        {
          id: "e2",
          sceneId: "s1",
          parentGroupId: null,
          elementType: "text" as const,
          zIndex: 1,
          locked: false,
          visible: true,
          transform: { x: 200, y: 200, width: 300, height: 80, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
          style: { color: "#fff", fontFamily: "Agharti", fontSize: 32, fontWeight: 600 },
          content: { text: "Hello" },
          binding: null,
          animation: {},
        },
      ],
    },
  ],
});

describe("CanvasStage", () => {
  beforeEach(() => {
    useBuilderStore.setState({
      design: fixture() as never,
      selectedElementIds: [],
      activeSceneId: "s1",
      zoomLevel: 1,
      dirty: false,
    });
  });

  it("renders one Konva node per element in active scene", () => {
    const { container } = render(<CanvasStage />);
    const rects = container.querySelectorAll('[data-konva-tag="Rect"]');
    const texts = container.querySelectorAll('[data-konva-tag="Text"]');
    expect(rects.length).toBeGreaterThanOrEqual(1);
    expect(texts.length).toBe(1);
  });

  it("Stage size falls back to 1:1 when container is unmeasurable", () => {
    // Fix 2026-05-19: CanvasStage now auto-fits via ResizeObserver on
    // its scroll container. In JSDOM `getBoundingClientRect()` returns
    // 0×0 so autoZoom stays at the fallback 1.0 — Stage receives the
    // raw 1920×1080 dimensions. In a real browser the ResizeObserver
    // shrinks zoom to fit the visible viewport (see /admin/broadcast/
    // v2/builder Chrome screenshots).
    useBuilderStore.setState({ zoomLevel: 0.5 });
    const { container } = render(<CanvasStage />);
    const stage = container.querySelector('[data-konva-tag="Stage"]');
    expect(stage?.getAttribute("width")).toBe("1920");
    expect(stage?.getAttribute("height")).toBe("1080");
  });

  it("renders nothing when activeSceneId is null", () => {
    useBuilderStore.setState({ activeSceneId: null });
    const { container } = render(<CanvasStage />);
    expect(container.querySelector('[data-konva-tag="Rect"]')).toBeNull();
  });
});

const shapesFixture = () => ({
  id: "d1", slug: "t", title: "T", mode: "single" as const,
  status: "draft" as const, canvasWidth: 1920, canvasHeight: 1080,
  scenes: [{
    id: "s1", designId: "d1", orderIndex: 0, durationMs: 5000,
    transitionIn: "fade", transitionOut: "fade",
    elements: [
      { id: "e-ellipse", elementType: "ellipse" as const, zIndex: 0, locked: false, visible: true,
        transform: { x: 0, y: 0, width: 200, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
        style: { fill: "#6bcd06" }, content: {} },
      { id: "e-line", elementType: "line" as const, zIndex: 1, locked: false, visible: true,
        transform: { x: 100, y: 200, width: 400, height: 4, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
        style: { stroke: "#fff", strokeWidth: 4 }, content: {} },
      { id: "e-polygon", elementType: "polygon" as const, zIndex: 2, locked: false, visible: true,
        transform: { x: 600, y: 100, width: 200, height: 200, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
        style: { fill: "#fe036d", sides: 6 }, content: {} },
    ],
  }],
});

describe("CanvasStage — Wave 1B shapes", () => {
  beforeEach(() => {
    useBuilderStore.setState({
      design: shapesFixture() as never,
      selectedElementIds: [],
      activeSceneId: "s1",
      zoomLevel: 1,
      dirty: false,
    });
  });

  it("renders a Konva Ellipse for ellipse elements", () => {
    const { container } = render(<CanvasStage />);
    expect(container.querySelectorAll('[data-konva-tag="Ellipse"]').length).toBe(1);
  });

  it("renders a Konva Line for line elements", () => {
    const { container } = render(<CanvasStage />);
    expect(container.querySelectorAll('[data-konva-tag="Line"]').length).toBe(1);
  });

  it("renders a Konva RegularPolygon for polygon elements", () => {
    const { container } = render(<CanvasStage />);
    expect(container.querySelectorAll('[data-konva-tag="RegularPolygon"]').length).toBe(1);
  });
});

describe("CanvasStage — Wave 1C groups", () => {
  beforeEach(() => {
    useBuilderStore.setState({
      design: fixture() as never,
      selectedElementIds: [],
      activeSceneId: "s1",
      zoomLevel: 1,
      dirty: false,
    });
  });

  it("nests children under a Konva Group when parentGroupId is set", () => {
    const d = fixture();
    const groupId = "grp-1";
    d.scenes[0].elements.push({
      id: groupId, elementType: "group" as const, zIndex: 5, locked: false, visible: true,
      transform: { x: 0, y: 0, width: 1920, height: 1080, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      style: {}, content: {}, parentGroupId: null,
    } as never);
    d.scenes[0].elements[0] = { ...d.scenes[0].elements[0], parentGroupId: groupId } as never;
    useBuilderStore.setState({ design: d as never });
    const { container } = render(<CanvasStage />);
    const groups = container.querySelectorAll('[data-konva-tag="Group"]');
    expect(groups.length).toBeGreaterThanOrEqual(1);
  });
});

describe("CanvasStage — Wave 1C multi-select Transformer", () => {
  beforeEach(() => {
    useBuilderStore.setState({
      design: fixture() as never,
      selectedElementIds: [],
      activeSceneId: "s1",
      zoomLevel: 1,
      dirty: false,
    });
  });

  it("mounts a Transformer when selectedElementIds.length > 1", () => {
    useBuilderStore.setState({ selectedElementIds: ["e1", "e2"] });
    const { container } = render(<CanvasStage />);
    expect(container.querySelector('[data-konva-tag="Transformer"]')).not.toBeNull();
  });

  it("no Transformer when only one element selected", () => {
    useBuilderStore.setState({ selectedElementIds: ["e1"] });
    const { container } = render(<CanvasStage />);
    expect(container.querySelector('[data-konva-tag="Transformer"]')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// Wave 3B (Task 14) — scrub preview
// ─────────────────────────────────────────────────────────────

const scrubFixture = () => ({
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
      elements: [
        {
          id: "e1",
          sceneId: "s1",
          parentGroupId: null,
          elementType: "rect" as const,
          zIndex: 0,
          locked: false,
          visible: true,
          // base opacity 1.0; entry timeline animates opacity 0 → 1
          // across 1000ms so a cursor at 500ms must resolve to 0.5.
          transform: {
            x: 100,
            y: 200,
            width: 100,
            height: 50,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            opacity: 1,
          },
          style: { fill: "#fe036d" },
          content: {},
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
                    { id: "kf-a", timeMs: 0, value: 0, easingOut: null },
                    { id: "kf-b", timeMs: 1000, value: 1, easingOut: null },
                  ],
                },
                {
                  property: "x",
                  keyframes: [
                    { id: "kf-c", timeMs: 0, value: 0, easingOut: null },
                    { id: "kf-d", timeMs: 1000, value: 40, easingOut: null },
                  ],
                },
              ],
            },
          },
        },
      ],
    },
  ],
});

describe("CanvasStage — Wave 3B scrub preview", () => {
  beforeEach(() => {
    useBuilderStore.setState({
      design: scrubFixture() as never,
      selectedElementIds: ["e1"],
      activeSceneId: "s1",
      zoomLevel: 1,
      dirty: false,
      timelinePanelOpen: false,
      timelineCursorMs: {},
      selectedKeyframeId: null,
    });
  });

  it("renders the canonical opacity when the timeline panel is closed", () => {
    useBuilderStore.setState({
      timelinePanelOpen: false,
      timelineCursorMs: { e1: { entry: 500 } },
    });
    const { container } = render(<CanvasStage />);
    const rect = container.querySelector('[data-konva-tag="Rect"]');
    // base transform.opacity = 1 — patch must NOT apply with panel closed.
    expect(rect?.getAttribute("opacity")).toBe("1");
  });

  it("applies the interpolated opacity when the timeline panel is open", () => {
    useBuilderStore.setState({
      timelinePanelOpen: true,
      timelineCursorMs: { e1: { entry: 500 } },
    });
    const { container } = render(<CanvasStage />);
    const rect = container.querySelector('[data-konva-tag="Rect"]');
    // Linear timeline 0 → 1 across 1000ms; midpoint cursor → 0.5.
    expect(rect?.getAttribute("opacity")).toBe("0.5");
  });

  it("adds the interpolated x as a delta on top of the base transform", () => {
    useBuilderStore.setState({
      timelinePanelOpen: true,
      timelineCursorMs: { e1: { entry: 500 } },
    });
    const { container } = render(<CanvasStage />);
    const rect = container.querySelector('[data-konva-tag="Rect"]');
    // base.x = 100, mid-timeline delta = 20 → rendered x = 120.
    expect(rect?.getAttribute("x")).toBe("120");
  });

  it("does not apply the patch when a different element is selected", () => {
    useBuilderStore.setState({
      timelinePanelOpen: true,
      timelineCursorMs: { e1: { entry: 500 } },
      selectedElementIds: ["other-id"],
    });
    const { container } = render(<CanvasStage />);
    const rect = container.querySelector('[data-konva-tag="Rect"]');
    // Element e1 is no longer the edit target → render statically.
    expect(rect?.getAttribute("opacity")).toBe("1");
    expect(rect?.getAttribute("x")).toBe("100");
  });

  it("does not apply the patch when no cursor is set", () => {
    useBuilderStore.setState({
      timelinePanelOpen: true,
      timelineCursorMs: {},
    });
    const { container } = render(<CanvasStage />);
    const rect = container.querySelector('[data-konva-tag="Rect"]');
    expect(rect?.getAttribute("opacity")).toBe("1");
    expect(rect?.getAttribute("x")).toBe("100");
  });

  it("snaps to the timeline endpoints at cursor 0 and at duration", () => {
    // Cursor at 0ms → opacity 0, x delta 0.
    useBuilderStore.setState({
      timelinePanelOpen: true,
      timelineCursorMs: { e1: { entry: 0 } },
    });
    {
      const { container } = render(<CanvasStage />);
      const rect = container.querySelector('[data-konva-tag="Rect"]');
      expect(rect?.getAttribute("opacity")).toBe("0");
      expect(rect?.getAttribute("x")).toBe("100");
    }
    // Cursor at 1000ms → opacity 1, x delta 40 (base 100 + 40 = 140).
    useBuilderStore.setState({
      timelineCursorMs: { e1: { entry: 1000 } },
    });
    {
      const { container } = render(<CanvasStage />);
      const rect = container.querySelector('[data-konva-tag="Rect"]');
      expect(rect?.getAttribute("opacity")).toBe("1");
      expect(rect?.getAttribute("x")).toBe("140");
    }
  });

  it("does not apply the patch when the element is part of a multi-selection", () => {
    useBuilderStore.setState({
      timelinePanelOpen: true,
      timelineCursorMs: { e1: { entry: 500 } },
      selectedElementIds: ["e1", "e2"],
    });
    const { container } = render(<CanvasStage />);
    const rect = container.querySelector('[data-konva-tag="Rect"]');
    // Multi-select → TimelinePanel hides and scrub preview suspends.
    expect(rect?.getAttribute("opacity")).toBe("1");
    expect(rect?.getAttribute("x")).toBe("100");
  });
});
