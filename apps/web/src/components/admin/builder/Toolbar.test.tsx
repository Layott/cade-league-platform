import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Toolbar } from "./Toolbar";
import { useBuilderStore, useTemporalStore } from "@/state/builder/store";

const fixtureDesign = () => ({
  id: "d1",
  slug: "test",
  title: "Test",
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

describe("Toolbar", () => {
  beforeEach(() => {
    useBuilderStore.setState({
      design: fixtureDesign() as never,
      selectedElementIds: [],
      activeSceneId: "s1",
      zoomLevel: 1,
      dirty: false,
      toolMode: "select",
      penDraft: null,
    });
    useTemporalStore.getState().clear();
  });

  it("renders Select / Rect / Text / Image / Data Slot / Undo / Redo buttons", () => {
    render(<Toolbar />);
    expect(screen.getByRole("button", { name: /select/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^rect$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^text$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^image$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /data slot/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /undo/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /redo/i })).toBeTruthy();
  });

  it("clicking Rect adds a rect element to active scene", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: /^rect$/i }));
    const els = useBuilderStore.getState().design!.scenes[0].elements;
    expect(els).toHaveLength(1);
    expect(els[0].elementType).toBe("rect");
    expect(els[0].transform.width).toBe(200);
    expect(els[0].transform.height).toBe(100);
  });

  it("clicking Text adds a text element with placeholder content", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: /^text$/i }));
    const els = useBuilderStore.getState().design!.scenes[0].elements;
    expect(els[0].elementType).toBe("text");
    expect(els[0].content?.text).toBe("Text");
  });

  it("Image button opens popover (does not insert directly)", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: /^image$/i }));
    const els = useBuilderStore.getState().design!.scenes[0].elements;
    expect(els).toHaveLength(0);
  });

  it("Image button opens a popover with Upload + From PSD sub-options", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: /^image$/i }));
    expect(screen.getByRole("menuitem", { name: /upload image/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /from psd/i })).toBeInTheDocument();
  });

  it("clicking Upload image still drops the placeholder image element", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: /^image$/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /upload image/i }));
    const els = useBuilderStore.getState().design!.scenes[0].elements;
    expect(els[0].elementType).toBe("image");
    expect(els[0].content?.assetId).toBe("image-placeholder");
  });

  it("clicking From PSD fires the open-psd-picker window event", () => {
    const handler = vi.fn();
    window.addEventListener("builder:open-psd-picker", handler);
    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: /^image$/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /from psd/i }));
    expect(handler).toHaveBeenCalled();
    window.removeEventListener("builder:open-psd-picker", handler);
  });

  it("Undo button fires temporal undo", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: /^rect$/i }));
    expect(useBuilderStore.getState().design!.scenes[0].elements).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    expect(useBuilderStore.getState().design!.scenes[0].elements).toHaveLength(0);
  });

  it("Redo button fires temporal redo", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: /^rect$/i }));
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    fireEvent.click(screen.getByRole("button", { name: /redo/i }));
    expect(useBuilderStore.getState().design!.scenes[0].elements).toHaveLength(1);
  });

  it("clicking Data Slot dispatches the panel-open event", () => {
    const handler = vi.fn();
    window.addEventListener("builder:open-data-slots", handler);
    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: /data slot/i }));
    expect(handler).toHaveBeenCalled();
    window.removeEventListener("builder:open-data-slots", handler);
  });

  it("renders Ellipse / Line / Polygon buttons", () => {
    render(<Toolbar />);
    expect(screen.getByRole("button", { name: /^ellipse$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^line$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^polygon$/i })).toBeInTheDocument();
  });

  it("clicking Ellipse adds an ellipse element", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: /^ellipse$/i }));
    const els = useBuilderStore.getState().design!.scenes[0].elements;
    expect(els[0].elementType).toBe("ellipse");
  });

  it("clicking Line adds a line element with stroke", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: /^line$/i }));
    const els = useBuilderStore.getState().design!.scenes[0].elements;
    expect(els[0].elementType).toBe("line");
    expect((els[0].style as { stroke?: string }).stroke).toBeDefined();
  });

  it("clicking Polygon adds a polygon with sides=6", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: /^polygon$/i }));
    const els = useBuilderStore.getState().design!.scenes[0].elements;
    expect(els[0].elementType).toBe("polygon");
    expect((els[0].style as { sides?: number }).sides).toBe(6);
  });

  it("renders the Pen button", () => {
    render(<Toolbar />);
    expect(screen.getByRole("button", { name: /^pen$/i })).toBeInTheDocument();
  });

  it("clicking Pen flips toolMode to pen and starts a fresh draft", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: /^pen$/i }));
    const s = useBuilderStore.getState();
    expect(s.toolMode).toBe("pen");
    expect(s.penDraft).not.toBeNull();
    expect(s.penDraft?.nodes).toEqual([]);
  });

  it("clicking Select while a pen draft is open cancels the draft", () => {
    useBuilderStore.setState({ toolMode: "pen", penDraft: { nodes: [], closed: false } });
    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: /select/i }));
    const s = useBuilderStore.getState();
    expect(s.toolMode).toBe("select");
    expect(s.penDraft).toBeNull();
  });
});
