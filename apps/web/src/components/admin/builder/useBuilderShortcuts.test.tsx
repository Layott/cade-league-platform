import { describe, expect, it, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { useBuilderShortcuts } from "./useBuilderShortcuts";
import { useBuilderStore, useTemporalStore } from "@/state/builder/store";

const copyMock = vi.fn();
const pasteMock = vi.fn();
vi.mock("@/state/builder/clipboard", () => ({
  copyElementsToClipboard: (...args: unknown[]) => copyMock(...args),
  pasteElementsFromClipboard: (...args: unknown[]) => pasteMock(...args),
}));

function Harness() {
  useBuilderShortcuts();
  return <div data-testid="harness" />;
}

const fixtureDesign = () => ({
  id: "d1", slug: "t", title: "T", mode: "single" as const, status: "draft" as const,
  canvasWidth: 1920, canvasHeight: 1080,
  scenes: [{ id: "s1", designId: "d1", orderIndex: 0, durationMs: 5000,
    transitionIn: "fade", transitionOut: "fade",
    elements: [{ id: "e1", elementType: "rect" as const, zIndex: 0, locked: false, visible: true,
      parentGroupId: null,
      transform: { x: 100, y: 100, width: 50, height: 50, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 },
      style: {}, content: {} }],
  }],
});

/** Map key names to their KeyboardEvent.code values for react-hotkeys-hook v5 matching. */
const KEY_TO_CODE: Record<string, string> = {
  Delete: "Delete",
  Backspace: "Backspace",
  Escape: "Escape",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  a: "KeyA", b: "KeyB", c: "KeyC", d: "KeyD", e: "KeyE",
  f: "KeyF", g: "KeyG", h: "KeyH", i: "KeyI", j: "KeyJ",
  k: "KeyK", l: "KeyL", m: "KeyM", n: "KeyN", o: "KeyO",
  p: "KeyP", q: "KeyQ", r: "KeyR", s: "KeyS", t: "KeyT",
  u: "KeyU", v: "KeyV", w: "KeyW", x: "KeyX", y: "KeyY", z: "KeyZ",
};

function pressKey(key: string, modifiers: { ctrl?: boolean; shift?: boolean; meta?: boolean } = {}) {
  // react-hotkeys-hook v5 attaches listeners to `document` and requires a
  // valid `code` property to match hotkeys (L(code) is used for key matching).
  // In jsdom, window.dispatchEvent and document.dispatchEvent are separate
  // targets — fire on document so the hook receives the event.
  const code = KEY_TO_CODE[key] ?? key;
  document.dispatchEvent(new KeyboardEvent("keydown", {
    key, code,
    ctrlKey: modifiers.ctrl ?? false,
    shiftKey: modifiers.shift ?? false,
    metaKey: modifiers.meta ?? false,
    bubbles: true,
  }));
}

describe("useBuilderShortcuts", () => {
  beforeEach(() => {
    useBuilderStore.setState({
      design: fixtureDesign() as never,
      selectedElementIds: ["e1"],
      activeSceneId: "s1",
      zoomLevel: 1,
      dirty: false,
      toolMode: "select",
      penDraft: null,
    });
    useTemporalStore.getState().clear();
    copyMock.mockReset();
    pasteMock.mockReset();
  });

  it("Delete removes every selected element", () => {
    render(<Harness />);
    pressKey("Delete");
    const els = useBuilderStore.getState().design!.scenes[0].elements;
    expect(els.find((e) => e.id === "e1")).toBeUndefined();
  });

  it("ArrowRight nudges selected by 1 px", () => {
    render(<Harness />);
    pressKey("ArrowRight");
    const el = useBuilderStore.getState().design!.scenes[0].elements[0];
    expect(el.transform.x).toBe(101);
  });

  it("Shift+ArrowDown nudges selected by 10 px", () => {
    render(<Harness />);
    pressKey("ArrowDown", { shift: true });
    const el = useBuilderStore.getState().design!.scenes[0].elements[0];
    expect(el.transform.y).toBe(110);
  });

  it("Escape clears selection", () => {
    render(<Harness />);
    pressKey("Escape");
    expect(useBuilderStore.getState().selectedElementIds).toEqual([]);
  });

  it("Ctrl+C calls copyElementsToClipboard", () => {
    render(<Harness />);
    pressKey("c", { ctrl: true });
    expect(copyMock).toHaveBeenCalled();
  });

  it("Ctrl+V calls pasteElementsFromClipboard", () => {
    render(<Harness />);
    pressKey("v", { ctrl: true });
    expect(pasteMock).toHaveBeenCalled();
  });

  it("Ctrl+D duplicates selection (copy then paste)", async () => {
    render(<Harness />);
    pressKey("d", { ctrl: true });
    // The handler fires both mocks inside an async IIFE; flush microtasks
    // so both calls resolve before the assertions.
    await Promise.resolve();
    await Promise.resolve();
    expect(copyMock).toHaveBeenCalled();
    expect(pasteMock).toHaveBeenCalled();
  });
});
