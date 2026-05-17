import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { CanvasStage } from "./CanvasStage";
import { useBuilderStore } from "@/state/builder/store";

// Mock react-konva so the test can render in jsdom without a real canvas.
vi.mock("react-konva", () => {
  const React = require("react");
  const make = (tag: string) =>
    React.forwardRef((props: Record<string, unknown>, ref: unknown) =>
      React.createElement(
        "div",
        { ...props, ref, "data-konva-tag": tag, role: tag === "Stage" ? "img" : undefined },
        props.children,
      ),
    );
  return {
    Stage: make("Stage"),
    Layer: make("Layer"),
    Rect: make("Rect"),
    Text: make("Text"),
    Image: make("Image"),
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

  it("Stage size reflects zoomLevel", () => {
    useBuilderStore.setState({ zoomLevel: 0.5 });
    const { container } = render(<CanvasStage />);
    const stage = container.querySelector('[data-konva-tag="Stage"]');
    expect(stage?.getAttribute("width")).toBe("960");
    expect(stage?.getAttribute("height")).toBe("540");
  });

  it("renders nothing when activeSceneId is null", () => {
    useBuilderStore.setState({ activeSceneId: null });
    const { container } = render(<CanvasStage />);
    expect(container.querySelector('[data-konva-tag="Rect"]')).toBeNull();
  });
});
