import { describe, expect, it, beforeEach } from "vitest";
import { useBuilderStore, useTemporalStore, toServerJson } from "./store";
import type { Design } from "@/server/overlays/builder/types";

const fixtureDesign = (): Design => ({
  id: "design-1",
  slug: "test-design",
  title: "Test Design",
  description: null,
  mode: "single",
  status: "draft",
  canvasWidth: 1920,
  canvasHeight: 1080,
  createdBy: "user-1",
  scenes: [
    {
      id: "scene-1",
      designId: "design-1",
      orderIndex: 0,
      name: null,
      durationMs: 5000,
      transitionIn: "fade",
      transitionOut: "fade",
      elements: [],
    },
  ],
});

describe("builder store", () => {
  beforeEach(() => {
    useBuilderStore.setState({
      design: null,
      selectedElementIds: [],
      activeSceneId: null,
      zoomLevel: 1.0,
      dirty: false,
    });
    useTemporalStore.getState().clear();
  });

  it("loadDesign hydrates state and clears dirty", () => {
    const d = fixtureDesign();
    useBuilderStore.getState().loadDesign(d);
    const s = useBuilderStore.getState();
    expect(s.design?.id).toBe("design-1");
    expect(s.activeSceneId).toBe("scene-1");
    expect(s.dirty).toBe(false);
  });

  it("addElement appends a new element and marks dirty", () => {
    useBuilderStore.getState().loadDesign(fixtureDesign());
    useBuilderStore.getState().addElement("scene-1", "rect", {
      transform: { x: 100, y: 100, width: 200, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      style: { fill: "#6bcd06" },
      zIndex: 0,
    });
    const elements = useBuilderStore.getState().design!.scenes[0].elements;
    expect(elements).toHaveLength(1);
    expect(elements[0].elementType).toBe("rect");
    expect(useBuilderStore.getState().dirty).toBe(true);
  });

  it("updateElement merges patch into matching element", () => {
    useBuilderStore.getState().loadDesign(fixtureDesign());
    useBuilderStore.getState().addElement("scene-1", "rect", {
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      style: {},
      zIndex: 0,
    });
    const id = useBuilderStore.getState().design!.scenes[0].elements[0].id;
    useBuilderStore.getState().updateElement(id, { style: { fill: "#fe036d" } });
    expect(useBuilderStore.getState().design!.scenes[0].elements[0].style.fill).toBe("#fe036d");
  });

  it("deleteElement removes element from scene", () => {
    useBuilderStore.getState().loadDesign(fixtureDesign());
    useBuilderStore.getState().addElement("scene-1", "rect", {
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      style: {},
      zIndex: 0,
    });
    const id = useBuilderStore.getState().design!.scenes[0].elements[0].id;
    useBuilderStore.getState().deleteElement(id);
    expect(useBuilderStore.getState().design!.scenes[0].elements).toHaveLength(0);
  });

  it("selectElement single + additive modes", () => {
    useBuilderStore.getState().selectElement("e1", false);
    expect(useBuilderStore.getState().selectedElementIds).toEqual(["e1"]);
    useBuilderStore.getState().selectElement("e2", true);
    expect(useBuilderStore.getState().selectedElementIds).toEqual(["e1", "e2"]);
    useBuilderStore.getState().selectElement("e3", false);
    expect(useBuilderStore.getState().selectedElementIds).toEqual(["e3"]);
  });

  it("reorderElement updates zIndex and resorts", () => {
    useBuilderStore.getState().loadDesign(fixtureDesign());
    useBuilderStore.getState().addElement("scene-1", "rect", {
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      style: {},
      zIndex: 0,
    });
    useBuilderStore.getState().addElement("scene-1", "text", {
      transform: { x: 0, y: 0, width: 100, height: 50, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      style: {},
      zIndex: 1,
    });
    const firstId = useBuilderStore.getState().design!.scenes[0].elements[0].id;
    useBuilderStore.getState().reorderElement(firstId, 5);
    const sorted = useBuilderStore.getState().design!.scenes[0].elements;
    expect(sorted[sorted.length - 1].id).toBe(firstId);
    expect(sorted[sorted.length - 1].zIndex).toBe(5);
  });

  it("setZoom updates zoomLevel", () => {
    useBuilderStore.getState().setZoom(0.5);
    expect(useBuilderStore.getState().zoomLevel).toBe(0.5);
  });

  it("markClean flips dirty to false", () => {
    useBuilderStore.setState({ dirty: true });
    useBuilderStore.getState().markClean();
    expect(useBuilderStore.getState().dirty).toBe(false);
  });

  it("undo + redo round-trip after mutations", () => {
    useBuilderStore.getState().loadDesign(fixtureDesign());
    useBuilderStore.getState().addElement("scene-1", "rect", {
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      style: {},
      zIndex: 0,
    });
    expect(useBuilderStore.getState().design!.scenes[0].elements).toHaveLength(1);
    useTemporalStore.getState().undo();
    // After undo, design should revert to the state before addElement
    // (which was set by loadDesign — empty elements)
    expect(useBuilderStore.getState().design!.scenes[0].elements).toHaveLength(0);
    useTemporalStore.getState().redo();
    expect(useBuilderStore.getState().design!.scenes[0].elements).toHaveLength(1);
  });

  it("temporal history caps at 100 entries", () => {
    useBuilderStore.getState().loadDesign(fixtureDesign());
    for (let i = 0; i < 110; i++) {
      useBuilderStore.getState().setZoom(1.0 + i * 0.01);
    }
    expect(useTemporalStore.getState().pastStates.length).toBeLessThanOrEqual(100);
  });

  it("toServerJson converts Design camelCase to SaveDesignInput snake_case", () => {
    const d = fixtureDesign();
    const wire = toServerJson(d);
    // Top-level canvas keys
    expect(wire.canvas_width).toBe(1920);
    expect(wire.canvas_height).toBe(1080);
    // Scene snake_case fields
    const scene = wire.scenes[0];
    expect(scene.order_index).toBe(0);
    expect(scene.duration_ms).toBe(5000);
    expect(scene.transition_in).toBe("fade");
    expect(scene.transition_out).toBe("fade");
    // camelCase keys must NOT exist on wire shape
    expect((wire as Record<string, unknown>).canvasWidth).toBeUndefined();
    expect((wire as Record<string, unknown>).canvasHeight).toBeUndefined();
    expect((scene as Record<string, unknown>).orderIndex).toBeUndefined();
    expect((scene as Record<string, unknown>).durationMs).toBeUndefined();
  });

  it("groupElements creates a new group element + sets children's parentGroupId", () => {
    useBuilderStore.getState().loadDesign(fixtureDesign());
    useBuilderStore.getState().addElement("scene-1", "rect", {
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      style: {}, zIndex: 0,
    });
    useBuilderStore.getState().addElement("scene-1", "rect", {
      transform: { x: 200, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      style: {}, zIndex: 1,
    });
    const ids = useBuilderStore.getState().design!.scenes[0].elements.map((e) => e.id);
    useBuilderStore.getState().groupElements(ids);
    const elements = useBuilderStore.getState().design!.scenes[0].elements;
    const group = elements.find((e) => e.elementType === "group");
    expect(group).toBeDefined();
    const children = elements.filter((e) => e.parentGroupId === group!.id);
    expect(children).toHaveLength(2);
  });

  it("groupElements rejects empty selection", () => {
    useBuilderStore.getState().loadDesign(fixtureDesign());
    useBuilderStore.getState().groupElements([]);
    const elements = useBuilderStore.getState().design!.scenes[0].elements;
    expect(elements.filter((e) => e.elementType === "group")).toHaveLength(0);
  });

  it("ungroupElements clears parentGroupId on children + soft-removes the group row", () => {
    useBuilderStore.getState().loadDesign(fixtureDesign());
    useBuilderStore.getState().addElement("scene-1", "rect", {
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      style: {}, zIndex: 0,
    });
    useBuilderStore.getState().addElement("scene-1", "rect", {
      transform: { x: 200, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      style: {}, zIndex: 1,
    });
    const ids = useBuilderStore.getState().design!.scenes[0].elements
      .filter((e) => e.elementType === "rect").map((e) => e.id);
    useBuilderStore.getState().groupElements(ids);
    const group = useBuilderStore.getState().design!.scenes[0].elements
      .find((e) => e.elementType === "group")!;
    useBuilderStore.getState().ungroupElements(group.id);
    const elements = useBuilderStore.getState().design!.scenes[0].elements;
    expect(elements.find((e) => e.id === group.id)).toBeUndefined();
    const stillParented = elements.filter((e) => e.parentGroupId === group.id);
    expect(stillParented).toHaveLength(0);
  });
});
