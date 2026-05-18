import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { KeyframeInspector } from "./KeyframeInspector";
import { useBuilderStore } from "@/state/builder/store";
import type {
  BezierEasing,
  Element,
  Keyframe,
  TimelineProperty,
} from "@/server/overlays/builder/types";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Reset the store before each test so cross-module leaks don't muddle
 * the spies. We mirror the EasingPresetDropdown + BezierHandle reset
 * shape — `design` stays null because the inspector receives its
 * element + phase via props.
 */
function resetStore() {
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
}

function mkKeyframe(overrides: Partial<Keyframe> = {}): Keyframe {
  return {
    id: "kf-1",
    timeMs: 0,
    value: 0.4,
    easingOut: null,
    ...overrides,
  };
}

function mkElement(
  property: TimelineProperty,
  keyframes: Keyframe[],
  durationMs = 1000,
): Element {
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
    content: {},
    binding: null,
    animation: {
      entry: {
        type: "noop",
        durationMs,
        delayMs: 0,
        easing: "linear",
        advancedTimeline: [
          {
            property,
            keyframes,
          },
        ],
      },
    },
  } as Element;
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe("KeyframeInspector — empty state", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows empty-state placeholder when no keyframe is selected", () => {
    const el = mkElement("opacity", [
      mkKeyframe({ id: "k1", timeMs: 0, value: 0 }),
      mkKeyframe({ id: "k2", timeMs: 400, value: 1 }),
    ]);
    render(<KeyframeInspector phase="entry" element={el} />);
    expect(screen.getByTestId("keyframe-inspector-empty")).toBeTruthy();
    expect(screen.getByText(/select a keyframe/i)).toBeTruthy();
    expect(screen.queryByTestId("keyframe-inspector")).toBeNull();
  });

  it("shows not-found state when selectedKeyframeId does not match any keyframe in this phase", () => {
    useBuilderStore.setState({ selectedKeyframeId: "ghost-id" });
    const el = mkElement("opacity", [
      mkKeyframe({ id: "k1", timeMs: 0, value: 0 }),
      mkKeyframe({ id: "k2", timeMs: 400, value: 1 }),
    ]);
    render(<KeyframeInspector phase="entry" element={el} />);
    expect(screen.getByTestId("keyframe-inspector-not-found")).toBeTruthy();
  });

  it("shows not-found state when the element has no animation for the current phase", () => {
    useBuilderStore.setState({ selectedKeyframeId: "kf-1" });
    const el: Element = {
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
        width: 0,
        height: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
      },
      style: {},
      content: {},
      binding: null,
      animation: {},
    } as Element;
    render(<KeyframeInspector phase="entry" element={el} />);
    expect(screen.getByTestId("keyframe-inspector-not-found")).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────
// Render — value editor switches per property kind
// ─────────────────────────────────────────────────────────────

describe("KeyframeInspector — render", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders property label + timeMs header for the selected keyframe", () => {
    useBuilderStore.setState({ selectedKeyframeId: "k1" });
    const el = mkElement("opacity", [
      mkKeyframe({ id: "k1", timeMs: 250, value: 0.4 }),
      mkKeyframe({ id: "k2", timeMs: 800, value: 1 }),
    ]);
    render(<KeyframeInspector phase="entry" element={el} />);
    expect(screen.getByTestId("keyframe-inspector-property").textContent).toBe(
      "opacity",
    );
    // The 250ms timestamp shows in the header.
    expect(screen.getByText(/250ms/)).toBeTruthy();
  });

  it("shows a numeric input with the current opacity value", () => {
    useBuilderStore.setState({ selectedKeyframeId: "k1" });
    const el = mkElement("opacity", [
      mkKeyframe({ id: "k1", timeMs: 0, value: 0.4 }),
      mkKeyframe({ id: "k2", timeMs: 400, value: 1 }),
    ]);
    render(<KeyframeInspector phase="entry" element={el} />);
    const input = screen.getByLabelText("value") as HTMLInputElement;
    expect(input.type).toBe("number");
    expect(input.valueAsNumber).toBe(0.4);
  });

  it("renders 0.05 step for opacity", () => {
    useBuilderStore.setState({ selectedKeyframeId: "k1" });
    const el = mkElement("opacity", [
      mkKeyframe({ id: "k1", timeMs: 0, value: 0 }),
      mkKeyframe({ id: "k2", timeMs: 400, value: 1 }),
    ]);
    render(<KeyframeInspector phase="entry" element={el} />);
    expect(
      (screen.getByLabelText("value") as HTMLInputElement).step,
    ).toBe("0.05");
  });

  it("renders 0.1 step for scaleX", () => {
    useBuilderStore.setState({ selectedKeyframeId: "k1" });
    const el = mkElement("scaleX", [
      mkKeyframe({ id: "k1", timeMs: 0, value: 1 }),
      mkKeyframe({ id: "k2", timeMs: 400, value: 1.2 }),
    ]);
    render(<KeyframeInspector phase="entry" element={el} />);
    expect(
      (screen.getByLabelText("value") as HTMLInputElement).step,
    ).toBe("0.1");
  });

  it("renders 1 step for rotation", () => {
    useBuilderStore.setState({ selectedKeyframeId: "k1" });
    const el = mkElement("rotation", [
      mkKeyframe({ id: "k1", timeMs: 0, value: 0 }),
      mkKeyframe({ id: "k2", timeMs: 400, value: 90 }),
    ]);
    render(<KeyframeInspector phase="entry" element={el} />);
    expect(
      (screen.getByLabelText("value") as HTMLInputElement).step,
    ).toBe("1");
  });

  it("renders a native color picker when property is color", () => {
    useBuilderStore.setState({ selectedKeyframeId: "kc-1" });
    const el = mkElement("color", [
      mkKeyframe({ id: "kc-1", timeMs: 0, value: "#fe036d" }),
      mkKeyframe({ id: "kc-2", timeMs: 400, value: "#6bcd06" }),
    ]);
    render(<KeyframeInspector phase="entry" element={el} />);
    const colorInput = screen.getByLabelText("color") as HTMLInputElement;
    expect(colorInput.type).toBe("color");
    expect(colorInput.value).toBe("#fe036d");
  });

  it("renders a plain text input when property is filter", () => {
    useBuilderStore.setState({ selectedKeyframeId: "kf-f" });
    const el = mkElement("filter", [
      mkKeyframe({
        id: "kf-f",
        timeMs: 0,
        value: "blur(4px) brightness(1.2)",
      }),
      mkKeyframe({
        id: "kf-f2",
        timeMs: 400,
        value: "none",
      }),
    ]);
    render(<KeyframeInspector phase="entry" element={el} />);
    const filterInput = screen.getByLabelText("filter") as HTMLInputElement;
    expect(filterInput.type).toBe("text");
    expect(filterInput.value).toBe("blur(4px) brightness(1.2)");
  });

  it("mounts the EasingPresetDropdown reflecting the keyframe's easingOut", () => {
    useBuilderStore.setState({ selectedKeyframeId: "k1" });
    const easing: BezierEasing = { x1: 0.42, y1: 0, x2: 1, y2: 1 };
    const el = mkElement("opacity", [
      mkKeyframe({ id: "k1", timeMs: 0, value: 0, easingOut: easing }),
      mkKeyframe({ id: "k2", timeMs: 400, value: 1 }),
    ]);
    render(<KeyframeInspector phase="entry" element={el} />);
    const dropdown = screen.getByTestId(
      "easing-preset-dropdown",
    ) as HTMLSelectElement;
    expect(dropdown.value).toBe("ease-in");
  });

  it("mounts the BezierHandle preview when the selected keyframe has an outgoing segment", () => {
    useBuilderStore.setState({ selectedKeyframeId: "k1" });
    const el = mkElement("opacity", [
      mkKeyframe({ id: "k1", timeMs: 0, value: 0 }),
      mkKeyframe({ id: "k2", timeMs: 400, value: 1 }),
    ]);
    render(<KeyframeInspector phase="entry" element={el} />);
    expect(screen.getByTestId("keyframe-inspector-bezier-preview")).toBeTruthy();
    // BezierHandle emits a stable data attribute we can latch onto so we
    // don't have to chase the nanoid-suffixed testid.
    const handle = document.querySelector(
      '[data-bezier-handle-wrapper="true"]',
    );
    expect(handle).not.toBeNull();
  });

  it("hides the BezierHandle preview when the selected keyframe is the last in its track", () => {
    useBuilderStore.setState({ selectedKeyframeId: "k2" });
    const el = mkElement("opacity", [
      mkKeyframe({ id: "k1", timeMs: 0, value: 0 }),
      mkKeyframe({ id: "k2", timeMs: 400, value: 1 }),
    ]);
    render(<KeyframeInspector phase="entry" element={el} />);
    expect(
      screen.queryByTestId("keyframe-inspector-bezier-preview"),
    ).toBeNull();
    expect(screen.getByTestId("keyframe-inspector-no-segment")).toBeTruthy();
  });

  it("selects the correct keyframe even when keyframes are out of time order on disk", () => {
    // Keyframes deliberately reversed in the source array; the inspector
    // sorts them before resolving "next" so the BezierHandle preview
    // spans the right interval.
    useBuilderStore.setState({ selectedKeyframeId: "k1" });
    const el = mkElement("opacity", [
      mkKeyframe({ id: "k2", timeMs: 400, value: 1 }),
      mkKeyframe({ id: "k1", timeMs: 0, value: 0 }),
    ]);
    render(<KeyframeInspector phase="entry" element={el} />);
    // k1 is the earlier keyframe + should still have an outgoing segment
    // to k2 (later in time).
    expect(screen.getByTestId("keyframe-inspector-bezier-preview")).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────
// Actions — value / time / delete dispatch through the store
// ─────────────────────────────────────────────────────────────

describe("KeyframeInspector — actions", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    cleanup();
  });

  it("changing the numeric value calls updateKeyframe with { value: number }", () => {
    const spy = vi.fn();
    useBuilderStore.setState({
      selectedKeyframeId: "k1",
      updateKeyframe: spy,
    });
    const el = mkElement("opacity", [
      mkKeyframe({ id: "k1", timeMs: 0, value: 0.4 }),
      mkKeyframe({ id: "k2", timeMs: 400, value: 1 }),
    ]);
    render(<KeyframeInspector phase="entry" element={el} />);
    fireEvent.change(screen.getByLabelText("value"), {
      target: { value: "0.7" },
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const [elementId, phase, property, kfId, patch] = spy.mock.calls[0]!;
    expect(elementId).toBe("el-1");
    expect(phase).toBe("entry");
    expect(property).toBe("opacity");
    expect(kfId).toBe("k1");
    expect(patch).toEqual({ value: 0.7 });
  });

  it("changing the color value forwards the hex string", () => {
    const spy = vi.fn();
    useBuilderStore.setState({
      selectedKeyframeId: "kc-1",
      updateKeyframe: spy,
    });
    const el = mkElement("color", [
      mkKeyframe({ id: "kc-1", timeMs: 0, value: "#fe036d" }),
      mkKeyframe({ id: "kc-2", timeMs: 400, value: "#6bcd06" }),
    ]);
    render(<KeyframeInspector phase="entry" element={el} />);
    fireEvent.change(screen.getByLabelText("color"), {
      target: { value: "#abcdef" },
    });
    expect(spy.mock.calls[0]![4]).toEqual({ value: "#abcdef" });
  });

  it("changing the filter value forwards the raw CSS string", () => {
    const spy = vi.fn();
    useBuilderStore.setState({
      selectedKeyframeId: "kf-f",
      updateKeyframe: spy,
    });
    const el = mkElement("filter", [
      mkKeyframe({ id: "kf-f", timeMs: 0, value: "none" }),
      mkKeyframe({ id: "kf-f2", timeMs: 400, value: "blur(8px)" }),
    ]);
    render(<KeyframeInspector phase="entry" element={el} />);
    fireEvent.change(screen.getByLabelText("filter"), {
      target: { value: "saturate(2)" },
    });
    expect(spy.mock.calls[0]![4]).toEqual({ value: "saturate(2)" });
  });

  it("changing the time input calls updateKeyframe with { timeMs }", () => {
    const spy = vi.fn();
    useBuilderStore.setState({
      selectedKeyframeId: "k1",
      updateKeyframe: spy,
    });
    const el = mkElement("opacity", [
      mkKeyframe({ id: "k1", timeMs: 0, value: 0 }),
      mkKeyframe({ id: "k2", timeMs: 400, value: 1 }),
    ]);
    render(<KeyframeInspector phase="entry" element={el} />);
    fireEvent.change(screen.getByLabelText("time"), {
      target: { value: "200" },
    });
    expect(spy.mock.calls[0]![4]).toEqual({ timeMs: 200 });
  });

  it("clamps a negative time entry to 0 when forwarding to updateKeyframe", () => {
    const spy = vi.fn();
    useBuilderStore.setState({
      selectedKeyframeId: "k1",
      updateKeyframe: spy,
    });
    const el = mkElement("opacity", [
      mkKeyframe({ id: "k1", timeMs: 100, value: 0 }),
      mkKeyframe({ id: "k2", timeMs: 400, value: 1 }),
    ]);
    render(<KeyframeInspector phase="entry" element={el} />);
    fireEvent.change(screen.getByLabelText("time"), {
      target: { value: "-50" },
    });
    expect(spy.mock.calls[0]![4]).toEqual({ timeMs: 0 });
  });

  it("ignores empty-string entries on numeric inputs (no NaN flush)", () => {
    const spy = vi.fn();
    useBuilderStore.setState({
      selectedKeyframeId: "k1",
      updateKeyframe: spy,
    });
    const el = mkElement("opacity", [
      mkKeyframe({ id: "k1", timeMs: 0, value: 0.5 }),
      mkKeyframe({ id: "k2", timeMs: 400, value: 1 }),
    ]);
    render(<KeyframeInspector phase="entry" element={el} />);
    fireEvent.change(screen.getByLabelText("value"), {
      target: { value: "" },
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("Delete button calls removeKeyframe + clears the selection via selectKeyframe(null)", () => {
    const remove = vi.fn();
    const select = vi.fn();
    useBuilderStore.setState({
      selectedKeyframeId: "k1",
      removeKeyframe: remove,
      selectKeyframe: select,
    });
    const el = mkElement("opacity", [
      mkKeyframe({ id: "k1", timeMs: 0, value: 0 }),
      mkKeyframe({ id: "k2", timeMs: 400, value: 1 }),
    ]);
    render(<KeyframeInspector phase="entry" element={el} />);
    fireEvent.click(screen.getByRole("button", { name: /delete keyframe/i }));
    expect(remove).toHaveBeenCalledTimes(1);
    const [elementId, phase, property, kfId] = remove.mock.calls[0]!;
    expect(elementId).toBe("el-1");
    expect(phase).toBe("entry");
    expect(property).toBe("opacity");
    expect(kfId).toBe("k1");
    expect(select).toHaveBeenCalledWith(null);
  });
});

// ─────────────────────────────────────────────────────────────
// Phase wiring — actions forward the correct phase
// ─────────────────────────────────────────────────────────────

describe("KeyframeInspector — phase wiring", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    cleanup();
  });

  it("forwards the exit phase into updateKeyframe when phase prop is exit", () => {
    const spy = vi.fn();
    useBuilderStore.setState({
      selectedKeyframeId: "kx-1",
      updateKeyframe: spy,
    });
    const el: Element = {
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
        width: 0,
        height: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        opacity: 1,
      },
      style: {},
      content: {},
      binding: null,
      animation: {
        exit: {
          type: "noop",
          durationMs: 400,
          delayMs: 0,
          easing: "linear",
          advancedTimeline: [
            {
              property: "opacity",
              keyframes: [
                {
                  id: "kx-1",
                  timeMs: 0,
                  value: 1,
                  easingOut: null,
                },
                {
                  id: "kx-2",
                  timeMs: 400,
                  value: 0,
                  easingOut: null,
                },
              ],
            },
          ],
        },
      },
    } as Element;
    render(<KeyframeInspector phase="exit" element={el} />);
    fireEvent.change(screen.getByLabelText("value"), {
      target: { value: "0.5" },
    });
    expect(spy.mock.calls[0]![1]).toBe("exit");
  });
});
