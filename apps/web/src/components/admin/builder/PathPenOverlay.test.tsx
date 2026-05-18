import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { PathPenOverlay } from "./PathPenOverlay";
import { useBuilderStore } from "@/state/builder/store";

vi.mock("react-konva", () => {
  const React = require("react");
  const make = (tag: string) =>
    React.forwardRef((props: Record<string, unknown>, ref: unknown) =>
      React.createElement("div", { ...props, ref, "data-konva-tag": tag }, props.children),
    );
  return {
    Layer: make("Layer"),
    Circle: make("Circle"),
    Line: make("Line"),
    Group: make("Group"),
  };
});

const fixture = () => ({
  id: "d1",
  slug: "t",
  title: "T",
  mode: "single" as const,
  status: "draft" as const,
  canvasWidth: 1920,
  canvasHeight: 1080,
  scenes: [
    {
      id: "s1",
      designId: "d1",
      orderIndex: 0,
      durationMs: 5000,
      transitionIn: "fade",
      transitionOut: "fade",
      elements: [],
    },
  ],
});

describe("PathPenOverlay", () => {
  beforeEach(() => {
    useBuilderStore.setState({
      design: fixture() as never,
      selectedElementIds: [],
      activeSceneId: "s1",
      zoomLevel: 1,
      dirty: false,
      toolMode: "pen",
      penDraft: { nodes: [], closed: false },
    });
  });

  it("renders one anchor circle per draft node", () => {
    useBuilderStore.setState({
      penDraft: {
        nodes: [
          { x: 0, y: 0, ctrlInX: 0, ctrlInY: 0, ctrlOutX: 0, ctrlOutY: 0 },
          { x: 100, y: 100, ctrlInX: 100, ctrlInY: 100, ctrlOutX: 100, ctrlOutY: 100 },
        ],
        closed: false,
      },
    });
    const { container } = render(<PathPenOverlay />);
    const anchors = container.querySelectorAll('[data-konva-tag="Circle"][data-anchor="true"]');
    expect(anchors.length).toBe(2);
  });

  it("renders nothing when toolMode is not pen", () => {
    useBuilderStore.setState({ toolMode: "select" });
    const { container } = render(<PathPenOverlay />);
    expect(container.querySelector('[data-konva-tag="Layer"]')).toBeNull();
  });

  it("completePenDraft inserts a path element on the active scene", () => {
    useBuilderStore.setState({
      penDraft: {
        nodes: [
          { x: 10, y: 10, ctrlInX: 10, ctrlInY: 10, ctrlOutX: 10, ctrlOutY: 10 },
          { x: 110, y: 110, ctrlInX: 110, ctrlInY: 110, ctrlOutX: 110, ctrlOutY: 110 },
        ],
        closed: false,
      },
    });
    useBuilderStore.getState().completePenDraft("s1", {
      x: 10,
      y: 10,
      width: 100,
      height: 100,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
    });
    const els = useBuilderStore.getState().design!.scenes[0].elements;
    expect(els).toHaveLength(1);
    expect(els[0].elementType).toBe("path");
    expect(useBuilderStore.getState().toolMode).toBe("select");
  });

  it("cancelPenDraft clears draft + flips back to select mode", () => {
    useBuilderStore.getState().cancelPenDraft();
    expect(useBuilderStore.getState().penDraft).toBeNull();
    expect(useBuilderStore.getState().toolMode).toBe("select");
  });
});
