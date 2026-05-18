import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  EASING_PRESETS,
  EasingPresetDropdown,
  matchPreset,
} from "./EasingPresetDropdown";
import { useBuilderStore } from "@/state/builder/store";
import type { BezierEasing } from "@/server/overlays/builder/types";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function mkProps(
  overrides: Partial<React.ComponentProps<typeof EasingPresetDropdown>> = {},
): React.ComponentProps<typeof EasingPresetDropdown> {
  return {
    elementId: "el-1",
    phase: "entry",
    property: "opacity",
    keyframeId: "kf-1",
    easingOut: null,
    ...overrides,
  } satisfies React.ComponentProps<typeof EasingPresetDropdown>;
}

/**
 * Reset the store before each test so cross-module leaks don't muddle
 * the spy on `setBezierEasing`. We don't seed a design — the component
 * reads its data from props; only `setBezierEasing` is consumed via
 * the store and can be replaced wholesale per test.
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

function getSelect(): HTMLSelectElement {
  return screen.getByTestId("easing-preset-dropdown") as HTMLSelectElement;
}

// ─────────────────────────────────────────────────────────────
// matchPreset — pure helper round-trip
// ─────────────────────────────────────────────────────────────

describe("matchPreset", () => {
  it("returns 'linear' for null easing", () => {
    expect(matchPreset(null)).toBe("linear");
  });

  it("returns the preset name when easing matches exactly", () => {
    expect(matchPreset({ x1: 0.42, y1: 0, x2: 1, y2: 1 })).toBe("ease-in");
    expect(matchPreset({ x1: 0, y1: 0, x2: 0.58, y2: 1 })).toBe("ease-out");
    expect(matchPreset({ x1: 0.42, y1: 0, x2: 0.58, y2: 1 })).toBe(
      "ease-in-out",
    );
    expect(matchPreset({ x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 })).toBe("ease");
  });

  it("returns the preset name when easing is within the 0.01 tolerance", () => {
    // Each axis nudged by 0.005 — still inside the 0.01 window.
    expect(matchPreset({ x1: 0.425, y1: 0.005, x2: 0.995, y2: 0.995 })).toBe(
      "ease-in",
    );
  });

  it("returns 'custom' when easing falls outside the tolerance on any axis", () => {
    // x1 drifts 0.05 off the ease-in preset (0.42 → 0.37).
    expect(matchPreset({ x1: 0.37, y1: 0, x2: 1, y2: 1 })).toBe("custom");
  });

  it("returns 'custom' for an arbitrary off-preset easing", () => {
    expect(matchPreset({ x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 })).toBe("custom");
  });
});

// ─────────────────────────────────────────────────────────────
// Render — option set + current-value resolution
// ─────────────────────────────────────────────────────────────

describe("EasingPresetDropdown — render", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    // Default test-setup doesn't auto-cleanup, so multiple renders
    // accumulate in document.body and getByTestId would pick up
    // previous-test instances. Explicit cleanup keeps each test
    // working against a fresh DOM.
    cleanup();
  });

  it("renders all 6 options (5 named presets + custom)", () => {
    render(<EasingPresetDropdown {...mkProps()} />);
    const select = getSelect();
    const options = within(select).getAllByRole("option");
    expect(options).toHaveLength(6);
    const values = options.map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual([
      "linear",
      "ease",
      "ease-in",
      "ease-out",
      "ease-in-out",
      "custom",
    ]);
  });

  it("auto-selects 'linear' when easingOut is null", () => {
    render(<EasingPresetDropdown {...mkProps({ easingOut: null })} />);
    expect(getSelect().value).toBe("linear");
  });

  it("auto-selects 'ease-in' when easingOut matches the ease-in preset", () => {
    render(
      <EasingPresetDropdown
        {...mkProps({ easingOut: { x1: 0.42, y1: 0, x2: 1, y2: 1 } })}
      />,
    );
    expect(getSelect().value).toBe("ease-in");
  });

  it("auto-selects 'ease-out' when easingOut matches the ease-out preset", () => {
    render(
      <EasingPresetDropdown
        {...mkProps({ easingOut: { x1: 0, y1: 0, x2: 0.58, y2: 1 } })}
      />,
    );
    expect(getSelect().value).toBe("ease-out");
  });

  it("auto-selects 'ease-in-out' when easingOut matches the ease-in-out preset", () => {
    render(
      <EasingPresetDropdown
        {...mkProps({ easingOut: { x1: 0.42, y1: 0, x2: 0.58, y2: 1 } })}
      />,
    );
    expect(getSelect().value).toBe("ease-in-out");
  });

  it("auto-selects 'custom' when easingOut does not match a named preset", () => {
    render(
      <EasingPresetDropdown
        {...mkProps({
          easingOut: { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 },
        })}
      />,
    );
    expect(getSelect().value).toBe("custom");
  });
});

// ─────────────────────────────────────────────────────────────
// onChange — writes through to setBezierEasing
// ─────────────────────────────────────────────────────────────

describe("EasingPresetDropdown — onChange", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    cleanup();
  });

  it("selecting 'ease-out' calls setBezierEasing with (0, 0, 0.58, 1)", () => {
    const spy = vi.fn();
    useBuilderStore.setState({ setBezierEasing: spy });

    render(
      <EasingPresetDropdown
        {...mkProps({
          elementId: "el-A",
          phase: "entry",
          property: "opacity",
          keyframeId: "kf-1",
        })}
      />,
    );
    fireEvent.change(getSelect(), { target: { value: "ease-out" } });
    expect(spy).toHaveBeenCalledTimes(1);
    const [elementId, phase, property, keyframeId, easing] =
      spy.mock.calls[0]!;
    expect(elementId).toBe("el-A");
    expect(phase).toBe("entry");
    expect(property).toBe("opacity");
    expect(keyframeId).toBe("kf-1");
    expect(easing).toEqual({ x1: 0, y1: 0, x2: 0.58, y2: 1 });
  });

  it("selecting 'linear' calls setBezierEasing with null (the store's linear representation)", () => {
    const spy = vi.fn();
    useBuilderStore.setState({ setBezierEasing: spy });

    render(
      <EasingPresetDropdown
        {...mkProps({
          easingOut: { x1: 0.42, y1: 0, x2: 1, y2: 1 }, // start on ease-in
        })}
      />,
    );
    fireEvent.change(getSelect(), { target: { value: "linear" } });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![4]).toBeNull();
  });

  it("selecting 'ease-in' calls setBezierEasing with (0.42, 0, 1, 1)", () => {
    const spy = vi.fn();
    useBuilderStore.setState({ setBezierEasing: spy });

    render(<EasingPresetDropdown {...mkProps()} />);
    fireEvent.change(getSelect(), { target: { value: "ease-in" } });
    expect(spy.mock.calls[0]![4]).toEqual({ x1: 0.42, y1: 0, x2: 1, y2: 1 });
  });

  it("selecting 'ease-in-out' calls setBezierEasing with (0.42, 0, 0.58, 1)", () => {
    const spy = vi.fn();
    useBuilderStore.setState({ setBezierEasing: spy });

    render(<EasingPresetDropdown {...mkProps()} />);
    fireEvent.change(getSelect(), { target: { value: "ease-in-out" } });
    expect(spy.mock.calls[0]![4]).toEqual({
      x1: 0.42,
      y1: 0,
      x2: 0.58,
      y2: 1,
    });
  });

  it("selecting 'ease' calls setBezierEasing with the canonical CSS ease curve", () => {
    const spy = vi.fn();
    useBuilderStore.setState({ setBezierEasing: spy });

    render(<EasingPresetDropdown {...mkProps()} />);
    fireEvent.change(getSelect(), { target: { value: "ease" } });
    expect(spy.mock.calls[0]![4]).toEqual({
      x1: 0.25,
      y1: 0.1,
      x2: 0.25,
      y2: 1,
    });
  });

  it("selecting 'custom' is a no-op — does not call setBezierEasing", () => {
    const spy = vi.fn();
    useBuilderStore.setState({ setBezierEasing: spy });

    const currentEasing: BezierEasing = { x1: 0.4, y1: 0, x2: 0.6, y2: 1 };
    render(
      <EasingPresetDropdown {...mkProps({ easingOut: currentEasing })} />,
    );
    fireEvent.change(getSelect(), { target: { value: "custom" } });
    expect(spy).not.toHaveBeenCalled();
  });

  it("forwards the keyframeId from props (not from a store selection)", () => {
    const spy = vi.fn();
    useBuilderStore.setState({ setBezierEasing: spy });

    render(
      <EasingPresetDropdown
        {...mkProps({ keyframeId: "kf-deep-in-the-tree" })}
      />,
    );
    fireEvent.change(getSelect(), { target: { value: "ease-in" } });
    expect(spy.mock.calls[0]![3]).toBe("kf-deep-in-the-tree");
  });

  it("forwards the phase + property from props for non-default tracks", () => {
    const spy = vi.fn();
    useBuilderStore.setState({ setBezierEasing: spy });

    render(
      <EasingPresetDropdown
        {...mkProps({ phase: "exit", property: "scaleX" })}
      />,
    );
    fireEvent.change(getSelect(), { target: { value: "ease-out" } });
    expect(spy.mock.calls[0]![1]).toBe("exit");
    expect(spy.mock.calls[0]![2]).toBe("scaleX");
  });
});

// ─────────────────────────────────────────────────────────────
// EASING_PRESETS — exported catalog sanity
// ─────────────────────────────────────────────────────────────

describe("EASING_PRESETS catalog", () => {
  it("declares linear as null (store's canonical linear representation)", () => {
    expect(EASING_PRESETS.linear).toBeNull();
  });

  it("declares the canonical CSS ease-in / ease-out / ease-in-out curves", () => {
    expect(EASING_PRESETS["ease-in"]).toEqual({ x1: 0.42, y1: 0, x2: 1, y2: 1 });
    expect(EASING_PRESETS["ease-out"]).toEqual({
      x1: 0,
      y1: 0,
      x2: 0.58,
      y2: 1,
    });
    expect(EASING_PRESETS["ease-in-out"]).toEqual({
      x1: 0.42,
      y1: 0,
      x2: 0.58,
      y2: 1,
    });
  });

  it("declares 5 named presets total (linear + 4 curves)", () => {
    expect(Object.keys(EASING_PRESETS)).toHaveLength(5);
  });
});
