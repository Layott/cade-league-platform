import { describe, expect, it, beforeEach, vi } from "vitest";
import { copyElementsToClipboard, pasteElementsFromClipboard } from "./clipboard";
import { useBuilderStore } from "./store";

const fixtureDesign = () => ({
  id: "d1", slug: "t", title: "T", mode: "single" as const,
  status: "draft" as const, canvasWidth: 1920, canvasHeight: 1080,
  scenes: [{ id: "s1", designId: "d1", orderIndex: 0, durationMs: 5000,
    transitionIn: "fade", transitionOut: "fade",
    elements: [
      { id: "rect-1", elementType: "rect" as const, zIndex: 0, locked: false, visible: true,
        parentGroupId: null,
        transform: { x: 50, y: 50, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
        style: { fill: "#6bcd06" }, content: {} },
      { id: "text-1", elementType: "text" as const, zIndex: 1, locked: false, visible: true,
        parentGroupId: null,
        transform: { x: 200, y: 200, width: 300, height: 60, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
        style: { fontFamily: "Agharti", fontSize: 32, color: "#fff" },
        content: { text: "Hi" } },
    ],
  }],
});

describe("clipboard", () => {
  let writeText: ReturnType<typeof vi.fn>;
  let readText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    useBuilderStore.setState({
      design: fixtureDesign() as never,
      selectedElementIds: ["rect-1"],
      activeSceneId: "s1",
      zoomLevel: 1,
      dirty: false,
    });
    writeText = vi.fn(async () => undefined);
    readText = vi.fn(async () => "");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText, readText },
    });
  });

  it("copyElementsToClipboard serializes selected elements with magic header", async () => {
    await copyElementsToClipboard();
    expect(writeText).toHaveBeenCalled();
    const payload = JSON.parse(writeText.mock.calls[0][0]);
    expect(payload.__cade_overlay_clip__).toBe(1);
    expect(payload.elements).toHaveLength(1);
    expect(payload.elements[0].elementType).toBe("rect");
  });

  it("pasteElementsFromClipboard inserts +20px-offset clones with fresh ids", async () => {
    readText.mockResolvedValueOnce(JSON.stringify({
      __cade_overlay_clip__: 1,
      elements: [{
        id: "rect-original",
        elementType: "rect",
        zIndex: 0, locked: false, visible: true, parentGroupId: null,
        transform: { x: 100, y: 100, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
        style: { fill: "#fe036d" }, content: {},
      }],
    }));
    await pasteElementsFromClipboard();
    const els = useBuilderStore.getState().design!.scenes[0].elements;
    const pasted = els[els.length - 1];
    expect(pasted.id).not.toBe("rect-original");
    expect(pasted.transform.x).toBe(120);
    expect(pasted.transform.y).toBe(120);
  });

  it("pasteElementsFromClipboard rewires parentGroupId via old->new id map", async () => {
    readText.mockResolvedValueOnce(JSON.stringify({
      __cade_overlay_clip__: 1,
      elements: [
        { id: "g-old", elementType: "group", zIndex: 0, locked: false, visible: true,
          parentGroupId: null,
          transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
          style: {}, content: {} },
        { id: "c-old", elementType: "rect", zIndex: 1, locked: false, visible: true,
          parentGroupId: "g-old",
          transform: { x: 0, y: 0, width: 50, height: 50, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
          style: {}, content: {} },
      ],
    }));
    await pasteElementsFromClipboard();
    const els = useBuilderStore.getState().design!.scenes[0].elements;
    const newGroup = els.find((e) => e.elementType === "group" && e.id !== "g-old")!;
    const newChild = els.find((e) => e.parentGroupId === newGroup.id)!;
    expect(newChild).toBeDefined();
    expect(newChild.id).not.toBe("c-old");
  });

  it("pasteElementsFromClipboard ignores payload without magic header", async () => {
    readText.mockResolvedValueOnce(JSON.stringify({ foo: "bar" }));
    const before = useBuilderStore.getState().design!.scenes[0].elements.length;
    await pasteElementsFromClipboard();
    const after = useBuilderStore.getState().design!.scenes[0].elements.length;
    expect(after).toBe(before);
  });
});
