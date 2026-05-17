import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PropertiesPanel } from "./PropertiesPanel";
import { useBuilderStore } from "@/state/builder/store";

const baseFixture = () => ({
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
          id: "rect-1",
          sceneId: "s1",
          parentGroupId: null,
          elementType: "rect" as const,
          zIndex: 0,
          locked: false,
          visible: true,
          transform: {
            x: 100,
            y: 100,
            width: 200,
            height: 100,
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
        {
          id: "text-1",
          sceneId: "s1",
          parentGroupId: null,
          elementType: "text" as const,
          zIndex: 1,
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
          style: { color: "#ffffff", fontFamily: "Agharti", fontSize: 32, fontWeight: 600 },
          content: { text: "Hello" },
          binding: null,
          animation: {},
        },
      ],
    },
  ],
});

describe("PropertiesPanel", () => {
  beforeEach(() => {
    useBuilderStore.setState({
      design: baseFixture() as never,
      selectedElementIds: ["rect-1"],
      activeSceneId: "s1",
      zoomLevel: 1,
      dirty: false,
    });
  });

  it("shows empty-state when nothing selected", () => {
    useBuilderStore.setState({ selectedElementIds: [] });
    render(<PropertiesPanel />);
    expect(screen.getByText(/select an element/i)).toBeTruthy();
  });

  it("renders Style / Transform / Animation tabs for a rect but NOT Binding", () => {
    render(<PropertiesPanel />);
    expect(screen.getByRole("tab", { name: /style/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /transform/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /animation/i })).toBeTruthy();
    // Binding tab hidden for rects (text + image only).
    expect(screen.queryByRole("tab", { name: /binding/i })).toBeNull();
  });

  it("shows Binding tab for text elements", () => {
    useBuilderStore.setState({ selectedElementIds: ["text-1"] });
    render(<PropertiesPanel />);
    expect(screen.getByRole("tab", { name: /binding/i })).toBeTruthy();
  });

  it("changing fill hex input triggers updateElement with new fill", () => {
    render(<PropertiesPanel />);
    const hex = screen.getByLabelText(/fill hex/i) as HTMLInputElement;
    fireEvent.change(hex, { target: { value: "#fe036d" } });
    expect(
      useBuilderStore.getState().design!.scenes[0].elements[0].style.fill,
    ).toBe("#fe036d");
  });

  it("Transform tab updates x via number input", () => {
    render(<PropertiesPanel />);
    fireEvent.click(screen.getByRole("tab", { name: /transform/i }));
    const xInput = screen.getByLabelText(/^x$/i) as HTMLInputElement;
    fireEvent.change(xInput, { target: { value: "500" } });
    expect(
      useBuilderStore.getState().design!.scenes[0].elements[0].transform.x,
    ).toBe(500);
  });

  it("Animation tab toggles entry animation on", () => {
    render(<PropertiesPanel />);
    fireEvent.click(screen.getByRole("tab", { name: /animation/i }));
    fireEvent.click(screen.getByLabelText(/enable entry/i));
    const el = useBuilderStore.getState().design!.scenes[0].elements[0];
    expect(el.animation?.entry?.type).toBeDefined();
  });

  it("StyleTab on rect exposes a gradient editor", () => {
    render(<PropertiesPanel />);
    expect(screen.getByLabelText(/linear/i)).toBeInTheDocument();
  });

  it("selecting Linear gradient stores GradientSpec on element.style.gradient", () => {
    render(<PropertiesPanel />);
    fireEvent.click(screen.getByLabelText(/linear/i));
    const g = useBuilderStore.getState().design!.scenes[0].elements[0].style.gradient as {
      kind: string;
    };
    expect(g.kind).toBe("linear");
  });
});
