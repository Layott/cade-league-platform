import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { BezierHandle } from "./BezierHandle";
import { useBuilderStore } from "@/state/builder/store";
import type { BezierEasing } from "@/server/overlays/builder/types";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function mkProps(
  overrides: Partial<React.ComponentProps<typeof BezierHandle>> = {},
): React.ComponentProps<typeof BezierHandle> {
  return {
    elementId: "el-1",
    phase: "entry",
    property: "opacity",
    fromKeyframeId: "kf-1",
    fromTimeMs: 0,
    toTimeMs: 500,
    pxPerSecond: 100,
    easingOut: null,
    ...overrides,
  } satisfies React.ComponentProps<typeof BezierHandle>;
}

/**
 * Reset the store before each test so cross-module leaks don't muddle
 * the spy on `setBezierEasing`. We don't seed a design — the component
 * reads its data from props, only `setBezierEasing` is consumed via the
 * store, and we can spy on it by reading `useBuilderStore.getState`.
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

// Stable selectors via data-bezier-* attributes — testid string contains
// a nanoid suffix which may itself include URL-safe `-`/`_` chars, so
// using a regex on the testid is fragile across runs. The data
// attributes the component emits are deterministic per-render.
function findSvg(): SVGSVGElement {
  const wrapper = document.querySelector<SVGSVGElement>(
    "[data-bezier-handle-wrapper='true']",
  );
  if (!wrapper) throw new Error("BezierHandle SVG wrapper not found");
  return wrapper;
}

function findControl(point: "p1" | "p2"): SVGCircleElement {
  const hit = document.querySelector<SVGCircleElement>(
    `[data-bezier-control='${point}']`,
  );
  if (!hit) throw new Error(`BezierHandle ${point} not found`);
  return hit;
}

function findCurve(): SVGPathElement {
  const hit = document.querySelector<SVGPathElement>(
    "[data-bezier-curve='true']",
  );
  if (!hit) throw new Error("BezierHandle curve path not found");
  return hit;
}

// ─────────────────────────────────────────────────────────────
// Render + geometry
// ─────────────────────────────────────────────────────────────

describe("BezierHandle — render + geometry", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    // Default test-setup doesn't auto-cleanup, so multiple renders
    // accumulate in document.body and find* helpers would pick up
    // previous-test instances. Explicit cleanup keeps each test
    // working against a fresh DOM.
    cleanup();
  });

  it("renders an SVG positioned at msToPx(fromTimeMs) with width msToPx(toTimeMs-fromTimeMs)", () => {
    render(
      <BezierHandle
        {...mkProps({
          fromTimeMs: 200,
          toTimeMs: 700,
          pxPerSecond: 100,
        })}
      />,
    );
    const svg = findSvg();
    // 200ms * 100 px/s / 1000 = 20px from start
    expect(svg.style.left).toBe("20px");
    // (700-200)ms * 100 / 1000 = 50px width
    expect(svg.style.width).toBe("50px");
  });

  it("respects a custom pxPerSecond for positioning", () => {
    render(
      <BezierHandle
        {...mkProps({
          fromTimeMs: 0,
          toTimeMs: 1000,
          pxPerSecond: 200,
        })}
      />,
    );
    const svg = findSvg();
    expect(svg.style.left).toBe("0px");
    expect(svg.style.width).toBe("200px");
  });

  it("renders a linear hairline path when easingOut is null", () => {
    render(
      <BezierHandle
        {...mkProps({
          fromTimeMs: 0,
          toTimeMs: 1000,
          pxPerSecond: 100,
          easingOut: null,
        })}
      />,
    );
    const path = findCurve();
    // Linear default: P1=(0,0) → px(0)=0, py(0)=28; P2=(1,1) → px(1)=100, py(1)=0.
    // Full path: M 0 28 C 0 28 100 0 100 0
    const d = path.getAttribute("d") ?? "";
    expect(d).toBe("M 0 28 C 0 28 100 0 100 0");
  });

  it("renders the bezier path with provided control points when easingOut is set", () => {
    const easing: BezierEasing = { x1: 0.4, y1: 0, x2: 0.6, y2: 1 };
    render(
      <BezierHandle
        {...mkProps({
          fromTimeMs: 0,
          toTimeMs: 1000,
          pxPerSecond: 100,
          easingOut: easing,
        })}
      />,
    );
    const path = findCurve();
    // px(0.4)=40, py(0)=28; px(0.6)=60, py(1)=0; end at (100, 0).
    expect(path.getAttribute("d")).toBe("M 0 28 C 40 28 60 0 100 0");
  });

  it("renders both control point circles at the bezier shape positions", () => {
    render(
      <BezierHandle
        {...mkProps({
          fromTimeMs: 0,
          toTimeMs: 1000,
          pxPerSecond: 100,
          easingOut: { x1: 0.4, y1: 0, x2: 0.6, y2: 1 },
        })}
      />,
    );
    const p1 = findControl("p1");
    const p2 = findControl("p2");
    expect(p1.getAttribute("cx")).toBe("40");
    expect(p1.getAttribute("cy")).toBe("28");
    expect(p2.getAttribute("cx")).toBe("60");
    expect(p2.getAttribute("cy")).toBe("0");
  });

  it("collapses to width=0 for back-to-back keyframes without crashing", () => {
    render(
      <BezierHandle
        {...mkProps({ fromTimeMs: 500, toTimeMs: 500, pxPerSecond: 100 })}
      />,
    );
    expect(findSvg().style.width).toBe("0px");
  });
});

// ─────────────────────────────────────────────────────────────
// Drag interaction — writes through to setBezierEasing
// ─────────────────────────────────────────────────────────────

describe("BezierHandle — drag", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    // Default test-setup doesn't auto-cleanup, so multiple renders
    // accumulate in document.body and find* helpers would pick up
    // previous-test instances. Explicit cleanup keeps each test
    // working against a fresh DOM.
    cleanup();
  });

  it("dragging P1 calls setBezierEasing with updated x1/y1 on the source keyframe", () => {
    const spy = vi.fn();
    // Replace the store action with a spy so we can inspect args.
    useBuilderStore.setState({ setBezierEasing: spy });

    render(
      <BezierHandle
        {...mkProps({
          elementId: "el-A",
          phase: "entry",
          property: "opacity",
          fromKeyframeId: "kf-from",
          fromTimeMs: 0,
          toTimeMs: 1000, // segmentWidthPx = 100
          pxPerSecond: 100,
          easingOut: { x1: 0.4, y1: 0, x2: 0.6, y2: 1 },
        })}
      />,
    );

    const p1 = findControl("p1");
    // start at clientX=100, clientY=10 → +25px x, -10px y
    fireEvent.mouseDown(p1, { clientX: 100, clientY: 10 });
    fireEvent.mouseMove(window, { clientX: 125, clientY: 0 });
    fireEvent.mouseUp(window);

    expect(spy).toHaveBeenCalled();
    const lastCall = spy.mock.calls[spy.mock.calls.length - 1];
    // (elementId, phase, property, keyframeId, easing)
    expect(lastCall[0]).toBe("el-A");
    expect(lastCall[1]).toBe("entry");
    expect(lastCall[2]).toBe("opacity");
    expect(lastCall[3]).toBe("kf-from");
    const easing = lastCall[4] as BezierEasing;
    // dx = 25/100 = 0.25 → x1 = 0.4 + 0.25 = 0.65
    expect(easing.x1).toBeCloseTo(0.65, 5);
    // dy = -((0)-(10))/28 = 10/28 → y1 = 0 + 10/28 ≈ 0.357
    expect(easing.y1).toBeCloseTo(10 / 28, 5);
    // P2 untouched
    expect(easing.x2).toBeCloseTo(0.6, 5);
    expect(easing.y2).toBeCloseTo(1, 5);
  });

  it("dragging P2 only updates x2/y2, leaving x1/y1 untouched", () => {
    const spy = vi.fn();
    useBuilderStore.setState({ setBezierEasing: spy });

    render(
      <BezierHandle
        {...mkProps({
          fromTimeMs: 0,
          toTimeMs: 1000,
          pxPerSecond: 100,
          easingOut: { x1: 0.2, y1: 0.1, x2: 0.5, y2: 0.5 },
        })}
      />,
    );

    const p2 = findControl("p2");
    fireEvent.mouseDown(p2, { clientX: 50, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: 60, clientY: 0 });
    fireEvent.mouseUp(window);

    const lastCall = spy.mock.calls[spy.mock.calls.length - 1];
    const easing = lastCall[4] as BezierEasing;
    expect(easing.x1).toBeCloseTo(0.2, 5);
    expect(easing.y1).toBeCloseTo(0.1, 5);
    // dx = 10/100 = 0.1 → x2 = 0.5 + 0.1 = 0.6
    expect(easing.x2).toBeCloseTo(0.6, 5);
    expect(easing.y2).toBeCloseTo(0.5, 5);
  });

  it("clamps x to [0, 1] when drag overshoots the right edge", () => {
    const spy = vi.fn();
    useBuilderStore.setState({ setBezierEasing: spy });

    render(
      <BezierHandle
        {...mkProps({
          fromTimeMs: 0,
          toTimeMs: 1000,
          pxPerSecond: 100,
          easingOut: { x1: 0.4, y1: 0, x2: 0.6, y2: 1 },
        })}
      />,
    );

    const p2 = findControl("p2");
    fireEvent.mouseDown(p2, { clientX: 1000, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: 5000, clientY: 0 });
    fireEvent.mouseUp(window);

    const lastCall = spy.mock.calls[spy.mock.calls.length - 1];
    const easing = lastCall[4] as BezierEasing;
    expect(easing.x2).toBeLessThanOrEqual(1);
    expect(easing.x2).toBeGreaterThanOrEqual(0);
    // Concretely: clamped to 1.
    expect(easing.x2).toBe(1);
  });

  it("clamps x to [0, 1] when drag overshoots the left edge", () => {
    const spy = vi.fn();
    useBuilderStore.setState({ setBezierEasing: spy });

    render(
      <BezierHandle
        {...mkProps({
          fromTimeMs: 0,
          toTimeMs: 1000,
          pxPerSecond: 100,
          easingOut: { x1: 0.4, y1: 0, x2: 0.6, y2: 1 },
        })}
      />,
    );

    const p1 = findControl("p1");
    fireEvent.mouseDown(p1, { clientX: 100, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: -9999, clientY: 0 });
    fireEvent.mouseUp(window);

    const lastCall = spy.mock.calls[spy.mock.calls.length - 1];
    const easing = lastCall[4] as BezierEasing;
    expect(easing.x1).toBe(0);
  });

  it("clamps y to upper bound 2 when drag overshoots upward", () => {
    const spy = vi.fn();
    useBuilderStore.setState({ setBezierEasing: spy });

    render(
      <BezierHandle
        {...mkProps({
          fromTimeMs: 0,
          toTimeMs: 1000,
          pxPerSecond: 100,
          easingOut: { x1: 0.4, y1: 0.5, x2: 0.6, y2: 0.5 },
        })}
      />,
    );

    const p1 = findControl("p1");
    // Drag massively upward — y should clamp to 2.
    fireEvent.mouseDown(p1, { clientX: 0, clientY: 1000 });
    fireEvent.mouseMove(window, { clientX: 0, clientY: -9999 });
    fireEvent.mouseUp(window);

    const lastCall = spy.mock.calls[spy.mock.calls.length - 1];
    expect((lastCall[4] as BezierEasing).y1).toBe(2);
  });

  it("clamps y to lower bound -1 when drag overshoots downward", () => {
    const spy = vi.fn();
    useBuilderStore.setState({ setBezierEasing: spy });

    render(
      <BezierHandle
        {...mkProps({
          fromTimeMs: 0,
          toTimeMs: 1000,
          pxPerSecond: 100,
          easingOut: { x1: 0.4, y1: 0.5, x2: 0.6, y2: 0.5 },
        })}
      />,
    );

    const p1 = findControl("p1");
    fireEvent.mouseDown(p1, { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: 0, clientY: 9999 });
    fireEvent.mouseUp(window);

    const lastCall = spy.mock.calls[spy.mock.calls.length - 1];
    expect((lastCall[4] as BezierEasing).y1).toBe(-1);
  });

  it("stops responding to mousemove after mouseup", () => {
    const spy = vi.fn();
    useBuilderStore.setState({ setBezierEasing: spy });

    render(
      <BezierHandle
        {...mkProps({
          fromTimeMs: 0,
          toTimeMs: 1000,
          pxPerSecond: 100,
          easingOut: { x1: 0.4, y1: 0, x2: 0.6, y2: 1 },
        })}
      />,
    );
    const p1 = findControl("p1");
    fireEvent.mouseDown(p1, { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: 10, clientY: 0 });
    expect(spy).toHaveBeenCalled();
    spy.mockClear();
    fireEvent.mouseUp(window);
    fireEvent.mouseMove(window, { clientX: 50, clientY: 0 });
    expect(spy).not.toHaveBeenCalled();
  });

  it("is a no-op for segments with zero width (degenerate back-to-back keyframes)", () => {
    const spy = vi.fn();
    useBuilderStore.setState({ setBezierEasing: spy });

    render(
      <BezierHandle
        {...mkProps({
          fromTimeMs: 500,
          toTimeMs: 500,
          pxPerSecond: 100,
          easingOut: { x1: 0.4, y1: 0, x2: 0.6, y2: 1 },
        })}
      />,
    );
    const p1 = findControl("p1");
    fireEvent.mouseDown(p1, { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: 50, clientY: 0 });
    fireEvent.mouseUp(window);
    expect(spy).not.toHaveBeenCalled();
  });

  it("stops React bubble-phase propagation on mousedown so parent React handlers do not also fire", () => {
    const setBezierEasingSpy = vi.fn();
    useBuilderStore.setState({ setBezierEasing: setBezierEasingSpy });
    const parentSpy = vi.fn();

    render(
      <div data-testid="parent" onMouseDown={parentSpy}>
        <BezierHandle
          {...mkProps({
            easingOut: { x1: 0.4, y1: 0, x2: 0.6, y2: 1 },
          })}
        />
      </div>,
    );

    const p1 = findControl("p1");
    fireEvent.mouseDown(p1, { clientX: 0, clientY: 0 });
    fireEvent.mouseUp(window);
    // React's bubble-phase parent handler must not fire — the bezier
    // control's onMouseDown stopPropagation'd.
    expect(parentSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// Wrapper SVG is non-blocking; control points are interactive
// ─────────────────────────────────────────────────────────────

describe("BezierHandle — pointer-events", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    // Default test-setup doesn't auto-cleanup, so multiple renders
    // accumulate in document.body and find* helpers would pick up
    // previous-test instances. Explicit cleanup keeps each test
    // working against a fresh DOM.
    cleanup();
  });

  it("wrapper SVG has pointer-events:none so it doesn't block clicks on the underlying clickarea", () => {
    render(<BezierHandle {...mkProps()} />);
    const svg = findSvg();
    expect(svg.className.baseVal).toContain("pointer-events-none");
  });

  it("control circles enable pointer-events so they receive drag", () => {
    render(<BezierHandle {...mkProps()} />);
    const p1 = findControl("p1");
    const p2 = findControl("p2");
    expect(p1.getAttribute("class") ?? "").toContain("pointer-events-auto");
    expect(p2.getAttribute("class") ?? "").toContain("pointer-events-auto");
  });
});
