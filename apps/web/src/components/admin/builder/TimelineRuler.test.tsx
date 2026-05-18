import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TimelineRuler, msToPx, pxToMs } from "./TimelineRuler";
import { useBuilderStore } from "@/state/builder/store";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * jsdom doesn't compute layout — getBoundingClientRect() returns zeros
 * for every element. Stub it on the rendered ruler track so the
 * mouse-down → ms math can be exercised deterministically. left=0
 * matches the cleanest model for math; the test feeds clientX raw.
 */
function stubTrackRect(opts: { left?: number; width?: number } = {}) {
  const left = opts.left ?? 0;
  const width = opts.width ?? 800;
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (
      this instanceof HTMLElement &&
      this.getAttribute("data-testid") === "timeline-ruler"
    ) {
      return {
        x: left,
        y: 0,
        left,
        right: left + width,
        top: 0,
        bottom: 32,
        width,
        height: 32,
        toJSON: () => ({}),
      } as DOMRect;
    }
    return original.call(this);
  };
  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

function resetStore() {
  useBuilderStore.setState({
    design: null,
    selectedElementIds: [],
    activeSceneId: null,
    zoomLevel: 1,
    dirty: false,
    timelinePanelOpen: false,
    timelineCursorMs: {},
  });
}

// ─────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────

describe("TimelineRuler — pixel-time conversion helpers", () => {
  it("msToPx scales linearly at 100 px/s by default", () => {
    expect(msToPx(0, 100)).toBe(0);
    expect(msToPx(1000, 100)).toBe(100);
    expect(msToPx(500, 100)).toBe(50);
    expect(msToPx(2500, 100)).toBe(250);
  });

  it("msToPx honors a custom pxPerSecond", () => {
    expect(msToPx(1000, 200)).toBe(200);
    expect(msToPx(1000, 50)).toBe(50);
  });

  it("pxToMs is the inverse of msToPx", () => {
    expect(pxToMs(0, 100)).toBe(0);
    expect(pxToMs(100, 100)).toBe(1000);
    expect(pxToMs(msToPx(1234, 100), 100)).toBeCloseTo(1234, 5);
  });

  it("pxToMs returns 0 when pxPerSecond is non-positive", () => {
    expect(pxToMs(100, 0)).toBe(0);
    expect(pxToMs(100, -10)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────

describe("TimelineRuler — tick rendering", () => {
  beforeEach(resetStore);

  it("renders one major tick per second (inclusive of 0 and durationMs)", () => {
    render(
      <TimelineRuler elementId="el-1" phase="entry" durationMs={3000} />,
    );
    // 0s, 1s, 2s, 3s → 4 major ticks
    expect(screen.getByTestId("ruler-tick-major-0")).toBeTruthy();
    expect(screen.getByTestId("ruler-tick-major-1000")).toBeTruthy();
    expect(screen.getByTestId("ruler-tick-major-2000")).toBeTruthy();
    expect(screen.getByTestId("ruler-tick-major-3000")).toBeTruthy();
  });

  it("renders 9 minor ticks per second slot (every 100ms, excluding majors)", () => {
    render(
      <TimelineRuler elementId="el-1" phase="entry" durationMs={1000} />,
    );
    // 100, 200, 300, 400, 500, 600, 700, 800, 900 → 9 minors between 0s and 1s
    const minors = screen.queryAllByTestId(/^ruler-tick-minor-/);
    expect(minors).toHaveLength(9);
  });

  it("positions major ticks at msToPx(t, pxPerSecond)", () => {
    render(
      <TimelineRuler
        elementId="el-1"
        phase="entry"
        durationMs={2000}
        pxPerSecond={120}
      />,
    );
    const t1 = screen.getByTestId("ruler-tick-major-1000") as HTMLElement;
    const t2 = screen.getByTestId("ruler-tick-major-2000") as HTMLElement;
    // 1000ms * 120 px/s / 1000 = 120px ; 2000ms = 240px
    expect(t1.style.left).toBe("120px");
    expect(t2.style.left).toBe("240px");
  });

  it("renders a numeric second label next to each major tick", () => {
    render(
      <TimelineRuler elementId="el-1" phase="entry" durationMs={2000} />,
    );
    expect(screen.getByTestId("ruler-label-0").textContent).toBe("0s");
    expect(screen.getByTestId("ruler-label-1000").textContent).toBe("1s");
    expect(screen.getByTestId("ruler-label-2000").textContent).toBe("2s");
  });

  it("renders only the 0s major tick when durationMs is 0", () => {
    render(
      <TimelineRuler elementId="el-1" phase="entry" durationMs={0} />,
    );
    expect(screen.getByTestId("ruler-tick-major-0")).toBeTruthy();
    expect(screen.queryByTestId("ruler-tick-major-1000")).toBeNull();
    expect(screen.queryAllByTestId(/^ruler-tick-minor-/)).toHaveLength(0);
  });

  it("clamps negative durations to 0", () => {
    render(
      <TimelineRuler elementId="el-1" phase="entry" durationMs={-500} />,
    );
    expect(screen.getByTestId("ruler-tick-major-0")).toBeTruthy();
    expect(screen.queryByTestId("ruler-tick-major-1000")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// Cursor position
// ─────────────────────────────────────────────────────────────

describe("TimelineRuler — cursor position", () => {
  beforeEach(resetStore);

  it("renders cursor at left=0 when store has no entry for (element, phase)", () => {
    render(
      <TimelineRuler elementId="el-1" phase="entry" durationMs={2000} />,
    );
    const cursor = screen.getByTestId("ruler-cursor") as HTMLElement;
    expect(cursor.style.left).toBe("0px");
  });

  it("renders cursor at msToPx(cursorMs) when store entry exists", () => {
    useBuilderStore.setState({
      timelineCursorMs: { "el-1": { entry: 250 } },
    });
    render(
      <TimelineRuler elementId="el-1" phase="entry" durationMs={1000} />,
    );
    const cursor = screen.getByTestId("ruler-cursor") as HTMLElement;
    // 250ms * 100 px/s / 1000 = 25px
    expect(cursor.style.left).toBe("25px");
  });

  it("clamps cursor to durationMs when stored value exceeds it", () => {
    useBuilderStore.setState({
      timelineCursorMs: { "el-1": { entry: 9999 } },
    });
    render(
      <TimelineRuler elementId="el-1" phase="entry" durationMs={1000} />,
    );
    const cursor = screen.getByTestId("ruler-cursor") as HTMLElement;
    // clamped to 1000ms → 100px
    expect(cursor.style.left).toBe("100px");
  });

  it("isolates cursor state across phases", () => {
    useBuilderStore.setState({
      timelineCursorMs: {
        "el-1": { entry: 200, exit: 800 },
      },
    });
    const { rerender } = render(
      <TimelineRuler elementId="el-1" phase="entry" durationMs={1000} />,
    );
    expect((screen.getByTestId("ruler-cursor") as HTMLElement).style.left).toBe(
      "20px",
    );
    rerender(
      <TimelineRuler elementId="el-1" phase="exit" durationMs={1000} />,
    );
    expect((screen.getByTestId("ruler-cursor") as HTMLElement).style.left).toBe(
      "80px",
    );
  });
});

// ─────────────────────────────────────────────────────────────
// Drag interaction
// ─────────────────────────────────────────────────────────────

describe("TimelineRuler — drag interaction", () => {
  let restoreRect: () => void;

  beforeEach(() => {
    resetStore();
    restoreRect = stubTrackRect({ left: 0, width: 800 });
  });
  afterEach(() => {
    restoreRect();
  });

  it("mousedown sets cursorMs based on clientX - rect.left", () => {
    render(
      <TimelineRuler elementId="el-1" phase="entry" durationMs={2000} />,
    );
    const track = screen.getByTestId("timeline-ruler");
    fireEvent.mouseDown(track, { clientX: 120, button: 0 });
    // 120 px / 100 px/s = 1.2s = 1200ms
    expect(useBuilderStore.getState().timelineCursorMs["el-1"]?.entry).toBe(
      1200,
    );
  });

  it("mousemove on the window updates cursorMs while drag is in progress", () => {
    render(
      <TimelineRuler elementId="el-1" phase="entry" durationMs={2000} />,
    );
    const track = screen.getByTestId("timeline-ruler");
    fireEvent.mouseDown(track, { clientX: 100, button: 0 });
    fireEvent.mouseMove(window, { clientX: 175 });
    expect(useBuilderStore.getState().timelineCursorMs["el-1"]?.entry).toBe(
      1750,
    );
    fireEvent.mouseMove(window, { clientX: 50 });
    expect(useBuilderStore.getState().timelineCursorMs["el-1"]?.entry).toBe(
      500,
    );
  });

  it("clamps cursor to [0, durationMs] during drag", () => {
    render(
      <TimelineRuler elementId="el-1" phase="entry" durationMs={1000} />,
    );
    const track = screen.getByTestId("timeline-ruler");
    fireEvent.mouseDown(track, { clientX: 50, button: 0 });
    // Drag way past the right edge
    fireEvent.mouseMove(window, { clientX: 9999 });
    expect(useBuilderStore.getState().timelineCursorMs["el-1"]?.entry).toBe(
      1000,
    );
    // Drag past the left edge
    fireEvent.mouseMove(window, { clientX: -200 });
    expect(useBuilderStore.getState().timelineCursorMs["el-1"]?.entry).toBe(0);
  });

  it("mouseup detaches the listeners so further moves are ignored", () => {
    render(
      <TimelineRuler elementId="el-1" phase="entry" durationMs={2000} />,
    );
    const track = screen.getByTestId("timeline-ruler");
    fireEvent.mouseDown(track, { clientX: 100, button: 0 });
    fireEvent.mouseUp(window);
    const spy = vi.spyOn(useBuilderStore.getState(), "setTimelineCursor");
    fireEvent.mouseMove(window, { clientX: 700 });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("respects a custom pxPerSecond when converting clientX to ms", () => {
    render(
      <TimelineRuler
        elementId="el-1"
        phase="entry"
        durationMs={2000}
        pxPerSecond={200}
      />,
    );
    const track = screen.getByTestId("timeline-ruler");
    fireEvent.mouseDown(track, { clientX: 100, button: 0 });
    // 100 px / 200 px/s = 0.5s = 500ms
    expect(useBuilderStore.getState().timelineCursorMs["el-1"]?.entry).toBe(
      500,
    );
  });

  it("offsets clientX by the track's bounding-rect left edge", () => {
    restoreRect();
    restoreRect = stubTrackRect({ left: 50, width: 800 });
    render(
      <TimelineRuler elementId="el-1" phase="entry" durationMs={2000} />,
    );
    const track = screen.getByTestId("timeline-ruler");
    fireEvent.mouseDown(track, { clientX: 150, button: 0 });
    // (150 - 50) px / 100 px/s = 1s = 1000ms
    expect(useBuilderStore.getState().timelineCursorMs["el-1"]?.entry).toBe(
      1000,
    );
  });
});
