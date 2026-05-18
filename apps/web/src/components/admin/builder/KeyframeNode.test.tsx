import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { KeyframeNode } from "./KeyframeNode";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function mkProps(overrides: Partial<React.ComponentProps<typeof KeyframeNode>> = {}) {
  return {
    id: "kf-1",
    timeMs: 250,
    durationMs: 1000,
    pxPerSecond: 100,
    selected: false,
    ...overrides,
  } satisfies React.ComponentProps<typeof KeyframeNode>;
}

/**
 * jsdom returns zeros for getBoundingClientRect(), so when a test wants
 * to exercise the rect-based drag path it passes an explicit
 * `containerRect` prop. The clientX-delta fallback (containerRect=null)
 * is the path most drag tests exercise — easier to reason about.
 */
function mkRect(left: number, width: number): DOMRect {
  return {
    x: left,
    y: 0,
    left,
    right: left + width,
    top: 0,
    bottom: 12,
    width,
    height: 12,
    toJSON: () => ({}),
  } as DOMRect;
}

// ─────────────────────────────────────────────────────────────
// Render + position math
// ─────────────────────────────────────────────────────────────

describe("KeyframeNode — render + position", () => {
  it("renders a diamond at msToPx(timeMs, pxPerSecond)", () => {
    render(<KeyframeNode {...mkProps({ timeMs: 250, pxPerSecond: 100 })} />);
    const node = screen.getByTestId("keyframe-node-kf-1") as HTMLElement;
    // 250ms * 100 px/s / 1000 = 25px
    expect(node.style.left).toBe("25px");
  });

  it("respects a custom pxPerSecond for positioning", () => {
    render(<KeyframeNode {...mkProps({ timeMs: 500, pxPerSecond: 200 })} />);
    const node = screen.getByTestId("keyframe-node-kf-1") as HTMLElement;
    // 500ms * 200 / 1000 = 100px
    expect(node.style.left).toBe("100px");
  });

  it("clamps a stored timeMs that exceeds durationMs to the right edge", () => {
    render(
      <KeyframeNode {...mkProps({ timeMs: 9999, durationMs: 1000, pxPerSecond: 100 })} />,
    );
    const node = screen.getByTestId("keyframe-node-kf-1") as HTMLElement;
    // clamped to 1000ms → 100px
    expect(node.style.left).toBe("100px");
  });

  it("exposes data-selected attribute reflecting the selected prop", () => {
    const { rerender } = render(<KeyframeNode {...mkProps({ selected: false })} />);
    expect(screen.getByTestId("keyframe-node-kf-1")).toHaveAttribute(
      "data-selected",
      "false",
    );
    rerender(<KeyframeNode {...mkProps({ selected: true })} />);
    expect(screen.getByTestId("keyframe-node-kf-1")).toHaveAttribute(
      "data-selected",
      "true",
    );
  });

  it("applies brand-green highlight class when selected", () => {
    render(<KeyframeNode {...mkProps({ selected: true })} />);
    const node = screen.getByTestId("keyframe-node-kf-1");
    expect(node.className).toContain("#6bcd06");
  });
});

// ─────────────────────────────────────────────────────────────
// Selection on mousedown
// ─────────────────────────────────────────────────────────────

describe("KeyframeNode — selection", () => {
  it("mousedown fires onSelect with the keyframe id", () => {
    const onSelect = vi.fn();
    render(<KeyframeNode {...mkProps({ id: "kf-42", onSelect })} />);
    fireEvent.mouseDown(screen.getByTestId("keyframe-node-kf-42"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("kf-42");
  });

  it("does not throw when no onSelect is provided (read-only marker)", () => {
    render(<KeyframeNode {...mkProps({ onSelect: undefined })} />);
    expect(() =>
      fireEvent.mouseDown(screen.getByTestId("keyframe-node-kf-1")),
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────
// Drag interaction (clientX-delta fallback path)
// ─────────────────────────────────────────────────────────────

describe("KeyframeNode — drag", () => {
  it("dragging horizontally calls onTimeChange with the new timeMs", () => {
    const onTimeChange = vi.fn();
    render(
      <KeyframeNode
        {...mkProps({
          id: "kf-1",
          timeMs: 200,
          durationMs: 5000,
          pxPerSecond: 100,
          onTimeChange,
        })}
      />,
    );
    const node = screen.getByTestId("keyframe-node-kf-1");
    // start: clientX=160 → mouseMove +80px @ 100px/s = 800ms delta
    // → 200ms start + 800 = 1000ms (well below the 5000ms clamp ceiling)
    fireEvent.mouseDown(node, { clientX: 160 });
    fireEvent.mouseMove(window, { clientX: 240 });
    expect(onTimeChange).toHaveBeenLastCalledWith(1000);
  });

  it("clamps the drag target to [0, durationMs]", () => {
    const onTimeChange = vi.fn();
    render(
      <KeyframeNode
        {...mkProps({
          timeMs: 500,
          durationMs: 1000,
          pxPerSecond: 100,
          onTimeChange,
        })}
      />,
    );
    const node = screen.getByTestId("keyframe-node-kf-1");
    fireEvent.mouseDown(node, { clientX: 50 });
    // Drag way past the right edge
    fireEvent.mouseMove(window, { clientX: 9999 });
    expect(onTimeChange).toHaveBeenLastCalledWith(1000);
    // Drag past the left edge
    fireEvent.mouseMove(window, { clientX: -9999 });
    expect(onTimeChange).toHaveBeenLastCalledWith(0);
  });

  it("stops responding to mousemove after mouseup", () => {
    const onTimeChange = vi.fn();
    render(
      <KeyframeNode
        {...mkProps({
          timeMs: 200,
          durationMs: 1000,
          pxPerSecond: 100,
          onTimeChange,
        })}
      />,
    );
    const node = screen.getByTestId("keyframe-node-kf-1");
    fireEvent.mouseDown(node, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 150 });
    expect(onTimeChange).toHaveBeenCalled();
    onTimeChange.mockClear();
    fireEvent.mouseUp(window);
    fireEvent.mouseMove(window, { clientX: 700 });
    expect(onTimeChange).not.toHaveBeenCalled();
  });

  it("uses containerRect.left when provided so absolute clientX maps to track-local px", () => {
    const onTimeChange = vi.fn();
    render(
      <KeyframeNode
        {...mkProps({
          timeMs: 0,
          durationMs: 2000,
          pxPerSecond: 100,
          onTimeChange,
          containerRect: mkRect(50, 800),
        })}
      />,
    );
    const node = screen.getByTestId("keyframe-node-kf-1");
    // start anywhere — the rect path ignores the mousedown clientX and
    // uses (ev.clientX - rect.left). clientX=250 → localX=200 → 2000ms.
    fireEvent.mouseDown(node, { clientX: 50 });
    fireEvent.mouseMove(window, { clientX: 250 });
    // (250 - 50) px / 100 px/s = 2s = 2000ms
    expect(onTimeChange).toHaveBeenLastCalledWith(2000);
  });

  it("does nothing on drag when onTimeChange is not provided (read-only)", () => {
    const onSelect = vi.fn();
    render(
      <KeyframeNode
        {...mkProps({ onSelect, onTimeChange: undefined })}
      />,
    );
    const node = screen.getByTestId("keyframe-node-kf-1");
    fireEvent.mouseDown(node, { clientX: 100 });
    expect(onSelect).toHaveBeenCalledTimes(1);
    // No listener was attached, so window mousemove is a no-op.
    expect(() =>
      fireEvent.mouseMove(window, { clientX: 200 }),
    ).not.toThrow();
  });
});
