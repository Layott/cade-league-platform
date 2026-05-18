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

  it("selectMultiple replaces selectedElementIds with deduped array", () => {
    useBuilderStore.getState().selectMultiple(["a", "b", "c", "b"]);
    expect(useBuilderStore.getState().selectedElementIds).toEqual(["a", "b", "c"]);
  });

  it("selectMultiple with empty array clears selection", () => {
    useBuilderStore.setState({ selectedElementIds: ["x"] });
    useBuilderStore.getState().selectMultiple([]);
    expect(useBuilderStore.getState().selectedElementIds).toEqual([]);
  });

  it("transient updates do not produce extra history entries", () => {
    useBuilderStore.getState().loadDesign(fixtureDesign());
    useBuilderStore.getState().addElement("scene-1", "rect", {
      transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      style: {}, zIndex: 0,
    });
    const id = useBuilderStore.getState().design!.scenes[0].elements[0].id;
    const baselinePast = useTemporalStore.getState().pastStates.length;
    for (let x = 0; x < 30; x++) {
      useBuilderStore.getState().updateElement(id, {
        transform: { x, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      } as never, { transient: true });
    }
    expect(useTemporalStore.getState().pastStates.length).toBe(baselinePast);
    useBuilderStore.getState().commitTransientHistory();
    expect(useTemporalStore.getState().pastStates.length).toBe(baselinePast + 1);
  });

  it("setActiveScene switches activeSceneId without marking dirty", () => {
    useBuilderStore.getState().loadDesign({
      id: "d1",
      slug: "x",
      title: "t",
      mode: "sequence",
      status: "draft",
      canvasWidth: 1920,
      canvasHeight: 1080,
      scenes: [
        { id: "s1", designId: "d1", orderIndex: 0, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] },
        { id: "s2", designId: "d1", orderIndex: 1, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] },
      ],
    } as never);
    useBuilderStore.getState().setActiveScene("s2");
    expect(useBuilderStore.getState().activeSceneId).toBe("s2");
    expect(useBuilderStore.getState().dirty).toBe(false);
  });

  it("addScene inserts at the requested position and marks dirty", () => {
    useBuilderStore.getState().loadDesign({
      id: "d1", slug: "x", title: "t", mode: "sequence", status: "draft",
      canvasWidth: 1920, canvasHeight: 1080,
      scenes: [{ id: "s1", designId: "d1", orderIndex: 0, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] }],
    } as never);
    useBuilderStore.getState().addScene({
      id: "s2", designId: "d1", orderIndex: 1, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [],
    });
    const scenes = useBuilderStore.getState().design!.scenes;
    expect(scenes).toHaveLength(2);
    expect(scenes[1].id).toBe("s2");
    expect(useBuilderStore.getState().dirty).toBe(true);
  });

  it("updateScene patches and marks dirty", () => {
    useBuilderStore.getState().loadDesign({
      id: "d1", slug: "x", title: "t", mode: "sequence", status: "draft",
      canvasWidth: 1920, canvasHeight: 1080,
      scenes: [{ id: "s1", designId: "d1", orderIndex: 0, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] }],
    } as never);
    useBuilderStore.getState().updateScene("s1", { durationMs: 12000, name: "intro" });
    const scene = useBuilderStore.getState().design!.scenes[0];
    expect(scene.durationMs).toBe(12000);
    expect(scene.name).toBe("intro");
    expect(useBuilderStore.getState().dirty).toBe(true);
  });

  it("deleteScene removes scene and re-densifies orderIndex", () => {
    useBuilderStore.getState().loadDesign({
      id: "d1", slug: "x", title: "t", mode: "sequence", status: "draft",
      canvasWidth: 1920, canvasHeight: 1080,
      scenes: [
        { id: "s1", designId: "d1", orderIndex: 0, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] },
        { id: "s2", designId: "d1", orderIndex: 1, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] },
        { id: "s3", designId: "d1", orderIndex: 2, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] },
      ],
    } as never);
    useBuilderStore.getState().setActiveScene("s2");
    useBuilderStore.getState().deleteScene("s2");
    const scenes = useBuilderStore.getState().design!.scenes;
    expect(scenes.map((s) => s.id)).toEqual(["s1", "s3"]);
    expect(scenes[1].orderIndex).toBe(1);
    expect(useBuilderStore.getState().activeSceneId).toBe("s1");
  });

  it("reorderScenes reassigns orderIndex according to the supplied order", () => {
    useBuilderStore.getState().loadDesign({
      id: "d1", slug: "x", title: "t", mode: "sequence", status: "draft",
      canvasWidth: 1920, canvasHeight: 1080,
      scenes: [
        { id: "s1", designId: "d1", orderIndex: 0, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] },
        { id: "s2", designId: "d1", orderIndex: 1, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] },
        { id: "s3", designId: "d1", orderIndex: 2, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] },
      ],
    } as never);
    useBuilderStore.getState().reorderScenes(["s3", "s1", "s2"]);
    const scenes = useBuilderStore.getState().design!.scenes;
    expect(scenes.map((s) => s.id)).toEqual(["s3", "s1", "s2"]);
    expect(scenes[0].orderIndex).toBe(0);
    expect(scenes[1].orderIndex).toBe(1);
    expect(scenes[2].orderIndex).toBe(2);
  });

  it("setMode flips mode and marks dirty", () => {
    useBuilderStore.getState().loadDesign({
      id: "d1", slug: "x", title: "t", mode: "single", status: "draft",
      canvasWidth: 1920, canvasHeight: 1080,
      scenes: [{ id: "s1", designId: "d1", orderIndex: 0, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] }],
    } as never);
    useBuilderStore.getState().setMode("sequence");
    expect(useBuilderStore.getState().design!.mode).toBe("sequence");
    expect(useBuilderStore.getState().dirty).toBe(true);
  });

  it("setMode('single') truncates scenes to the first when downgrading", () => {
    useBuilderStore.getState().loadDesign({
      id: "d1", slug: "x", title: "t", mode: "sequence", status: "draft",
      canvasWidth: 1920, canvasHeight: 1080,
      scenes: [
        { id: "s1", designId: "d1", orderIndex: 0, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] },
        { id: "s2", designId: "d1", orderIndex: 1, durationMs: 5000, transitionIn: "fade", transitionOut: "fade", elements: [] },
      ],
    } as never);
    useBuilderStore.getState().setActiveScene("s2");
    useBuilderStore.getState().setMode("single");
    const scenes = useBuilderStore.getState().design!.scenes;
    expect(scenes).toHaveLength(1);
    expect(scenes[0].id).toBe("s1");
    expect(useBuilderStore.getState().activeSceneId).toBe("s1");
  });
});

// ─────────────────────────────────────────────────────────────
// Wave 3B — advanced-timeline actions + mutual-exclusivity guard
// ─────────────────────────────────────────────────────────────

describe("zustand store — Wave 3B advanced timeline actions", () => {
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

  function setupStoreWithOneElement(): { elementId: string } {
    useBuilderStore.getState().loadDesign(fixtureDesign());
    useBuilderStore.getState().addElement("scene-1", "text", {
      transform: { x: 100, y: 100, width: 400, height: 80, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      style: { fill: "#ffffff", fontSize: 64 },
      content: { text: "T" },
    });
    const elementId = useBuilderStore.getState().design!.scenes[0].elements[0].id;
    return { elementId };
  }

  function getElement(elementId: string) {
    const design = useBuilderStore.getState().design!;
    for (const s of design.scenes) {
      const found = s.elements.find((e) => e.id === elementId);
      if (found) return found;
    }
    throw new Error(`Element ${elementId} not found`);
  }

  it("setElementAnimationMode('advanced') seeds opacity track with 2 keyframes", () => {
    const { elementId } = setupStoreWithOneElement();
    useBuilderStore.getState().setElementAnimationMode(elementId, "entry", "advanced");
    const el = getElement(elementId);
    expect(el.animation?.entry?.type).toBe("noop");
    expect(el.animation?.entry?.advancedTimeline).toHaveLength(1);
    expect(el.animation?.entry?.advancedTimeline?.[0].property).toBe("opacity");
    expect(el.animation?.entry?.advancedTimeline?.[0].keyframes).toHaveLength(2);
    expect(el.animation?.entry?.advancedTimeline?.[0].keyframes[0].timeMs).toBe(0);
    expect(el.animation?.entry?.advancedTimeline?.[0].keyframes[1].timeMs).toBe(600);
  });

  it("switching advanced -> preset clears advancedTimeline + restores a real preset type", () => {
    const { elementId } = setupStoreWithOneElement();
    useBuilderStore.getState().setElementAnimationMode(elementId, "entry", "advanced");
    useBuilderStore.getState().setElementAnimationMode(elementId, "entry", "preset");
    const el = getElement(elementId);
    expect(el.animation?.entry?.advancedTimeline).toBeUndefined();
    expect(el.animation?.entry?.type).not.toBe("noop");
  });

  it("setElementAnimationMode preserves a non-noop preset type when re-entering preset mode", () => {
    const { elementId } = setupStoreWithOneElement();
    // Seed an explicit preset first so the mode toggle has something
    // meaningful to round-trip through.
    useBuilderStore.getState().updateElement(elementId, {
      animation: {
        entry: { type: "slide-left", durationMs: 500, delayMs: 0, easing: "ease-out" },
      },
    });
    useBuilderStore.getState().setElementAnimationMode(elementId, "entry", "advanced");
    expect(getElement(elementId).animation?.entry?.type).toBe("noop");
    useBuilderStore.getState().setElementAnimationMode(elementId, "entry", "preset");
    // After bouncing back, the original 'slide-left' should NOT be
    // restored — we only restore the default when the sentinel was
    // active, which matches what the editor expects (user reselects a
    // preset from the dropdown).
    expect(getElement(elementId).animation?.entry?.type).not.toBe("noop");
    expect(getElement(elementId).animation?.entry?.advancedTimeline).toBeUndefined();
  });

  it("addKeyframe inserts a new keyframe sorted by timeMs", () => {
    const { elementId } = setupStoreWithOneElement();
    useBuilderStore.getState().setElementAnimationMode(elementId, "entry", "advanced");
    useBuilderStore.getState().addKeyframe(elementId, "entry", "opacity", 300, 0.5);
    const track = getElement(elementId).animation?.entry?.advancedTimeline?.find(
      (t) => t.property === "opacity",
    );
    expect(track?.keyframes.map((k) => k.timeMs)).toEqual([0, 300, 600]);
    expect(track?.keyframes.map((k) => k.value)).toEqual([0, 0.5, 1]);
  });

  it("addKeyframe on a property without a track creates the track", () => {
    const { elementId } = setupStoreWithOneElement();
    useBuilderStore.getState().setElementAnimationMode(elementId, "entry", "advanced");
    useBuilderStore.getState().addKeyframe(elementId, "entry", "x", 0, -120);
    useBuilderStore.getState().addKeyframe(elementId, "entry", "x", 600, 0);
    const tracks = getElement(elementId).animation?.entry?.advancedTimeline;
    expect(tracks?.map((t) => t.property).sort()).toEqual(["opacity", "x"]);
    const xTrack = tracks?.find((t) => t.property === "x");
    expect(xTrack?.keyframes.map((k) => k.timeMs)).toEqual([0, 600]);
  });

  it("addKeyframe is a no-op when advancedTimeline is not seeded", () => {
    const { elementId } = setupStoreWithOneElement();
    // Element has empty animation — no advancedTimeline. Action MUST
    // NOT crash and MUST NOT silently invent a phase.
    useBuilderStore.getState().addKeyframe(elementId, "entry", "opacity", 200, 0.4);
    expect(getElement(elementId).animation?.entry).toBeUndefined();
  });

  it("updateKeyframe patches timeMs + value + re-sorts", () => {
    const { elementId } = setupStoreWithOneElement();
    useBuilderStore.getState().setElementAnimationMode(elementId, "entry", "advanced");
    const tracks = getElement(elementId).animation!.entry!.advancedTimeline!;
    const kfId = tracks[0].keyframes[1].id;
    useBuilderStore.getState().updateKeyframe(elementId, "entry", "opacity", kfId, {
      timeMs: 400,
      value: 0.9,
    });
    const updated = getElement(elementId).animation?.entry?.advancedTimeline?.[0].keyframes.find(
      (k) => k.id === kfId,
    );
    expect(updated?.timeMs).toBe(400);
    expect(updated?.value).toBe(0.9);
  });

  it("updateKeyframe is a no-op when the keyframe id is unknown", () => {
    const { elementId } = setupStoreWithOneElement();
    useBuilderStore.getState().setElementAnimationMode(elementId, "entry", "advanced");
    const before = JSON.stringify(getElement(elementId).animation);
    useBuilderStore.getState().updateKeyframe(elementId, "entry", "opacity", "ghost-id", {
      timeMs: 999,
    });
    const after = JSON.stringify(getElement(elementId).animation);
    expect(after).toBe(before);
  });

  it("removeKeyframe drops the keyframe — track collapsed when <2 keyframes remain", () => {
    const { elementId } = setupStoreWithOneElement();
    useBuilderStore.getState().setElementAnimationMode(elementId, "entry", "advanced");
    const tracks = getElement(elementId).animation!.entry!.advancedTimeline!;
    const firstKfId = tracks[0].keyframes[0].id;
    useBuilderStore.getState().removeKeyframe(elementId, "entry", "opacity", firstKfId);
    const after = getElement(elementId).animation?.entry?.advancedTimeline;
    // Only one keyframe left → schema would fail .min(2), so collapse.
    expect(after?.find((t) => t.property === "opacity")).toBeUndefined();
  });

  it("removeKeyframe keeps the track when >=2 keyframes still remain", () => {
    const { elementId } = setupStoreWithOneElement();
    useBuilderStore.getState().setElementAnimationMode(elementId, "entry", "advanced");
    useBuilderStore.getState().addKeyframe(elementId, "entry", "opacity", 300, 0.5);
    const tracks = getElement(elementId).animation!.entry!.advancedTimeline!;
    const middleKfId = tracks[0].keyframes.find((k) => k.timeMs === 300)!.id;
    useBuilderStore.getState().removeKeyframe(elementId, "entry", "opacity", middleKfId);
    const after = getElement(elementId).animation?.entry?.advancedTimeline?.find(
      (t) => t.property === "opacity",
    );
    expect(after?.keyframes.map((k) => k.timeMs)).toEqual([0, 600]);
  });

  it("setBezierEasing patches easingOut on a specific keyframe", () => {
    const { elementId } = setupStoreWithOneElement();
    useBuilderStore.getState().setElementAnimationMode(elementId, "entry", "advanced");
    const tracks = getElement(elementId).animation!.entry!.advancedTimeline!;
    const kfId = tracks[0].keyframes[0].id;
    useBuilderStore.getState().setBezierEasing(elementId, "entry", "opacity", kfId, {
      x1: 0.4, y1: 0, x2: 0.6, y2: 1,
    });
    const updated = getElement(elementId).animation?.entry?.advancedTimeline?.[0].keyframes.find(
      (k) => k.id === kfId,
    );
    expect(updated?.easingOut).toEqual({ x1: 0.4, y1: 0, x2: 0.6, y2: 1 });
  });

  it("setBezierEasing(null) clears the bezier curve", () => {
    const { elementId } = setupStoreWithOneElement();
    useBuilderStore.getState().setElementAnimationMode(elementId, "entry", "advanced");
    const tracks = getElement(elementId).animation!.entry!.advancedTimeline!;
    const kfId = tracks[0].keyframes[0].id;
    useBuilderStore.getState().setBezierEasing(elementId, "entry", "opacity", kfId, {
      x1: 0.4, y1: 0, x2: 0.6, y2: 1,
    });
    useBuilderStore.getState().setBezierEasing(elementId, "entry", "opacity", kfId, null);
    const updated = getElement(elementId).animation?.entry?.advancedTimeline?.[0].keyframes.find(
      (k) => k.id === kfId,
    );
    expect(updated?.easingOut).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// Wave 3B (Task 5+6) — timeline panel visibility
// ─────────────────────────────────────────────────────────────

describe("zustand store — Wave 3B timeline panel visibility", () => {
  beforeEach(() => {
    useBuilderStore.setState({
      design: null,
      selectedElementIds: [],
      activeSceneId: null,
      zoomLevel: 1.0,
      dirty: false,
      timelinePanelOpen: false,
    });
    useTemporalStore.getState().clear();
  });

  it("toggleTimelinePanel flips timelinePanelOpen", () => {
    expect(useBuilderStore.getState().timelinePanelOpen).toBe(false);
    useBuilderStore.getState().toggleTimelinePanel();
    expect(useBuilderStore.getState().timelinePanelOpen).toBe(true);
    useBuilderStore.getState().toggleTimelinePanel();
    expect(useBuilderStore.getState().timelinePanelOpen).toBe(false);
  });

  it("openTimelinePanel + closeTimelinePanel set the flag explicitly", () => {
    useBuilderStore.getState().openTimelinePanel();
    expect(useBuilderStore.getState().timelinePanelOpen).toBe(true);
    useBuilderStore.getState().openTimelinePanel(); // idempotent
    expect(useBuilderStore.getState().timelinePanelOpen).toBe(true);
    useBuilderStore.getState().closeTimelinePanel();
    expect(useBuilderStore.getState().timelinePanelOpen).toBe(false);
    useBuilderStore.getState().closeTimelinePanel(); // idempotent
    expect(useBuilderStore.getState().timelinePanelOpen).toBe(false);
  });
});
