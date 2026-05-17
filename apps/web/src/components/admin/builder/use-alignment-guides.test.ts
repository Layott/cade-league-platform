import { describe, expect, it } from "vitest";
import { computeAlignmentGuides } from "./use-alignment-guides";

describe("computeAlignmentGuides", () => {
  const canvas = { width: 1920, height: 1080 };

  it("returns no guides when no other elements within proximity", () => {
    const result = computeAlignmentGuides(
      { x: 100, y: 100, width: 200, height: 100 },
      [{ id: "o1", transform: { x: 1500, y: 800, width: 100, height: 50 } }],
      canvas,
    );
    expect(result.guides).toEqual([]);
    expect(result.snappedX).toBe(100);
    expect(result.snappedY).toBe(100);
  });

  it("snaps to a matching left edge of another element", () => {
    const result = computeAlignmentGuides(
      { x: 502, y: 200, width: 100, height: 50 },
      [{ id: "o1", transform: { x: 500, y: 100, width: 100, height: 50 } }],
      canvas,
    );
    expect(result.snappedX).toBe(500);
    expect(result.guides.some((g) => g.kind === "v" && g.pos === 500)).toBe(true);
  });

  it("snaps to canvas center horizontally", () => {
    const result = computeAlignmentGuides(
      { x: 859, y: 540, width: 200, height: 100 },
      [],
      canvas,
    );
    // canvas center = 960. dragged center = 859 + 100 = 959.
    // snap to canvas center → dragged.x = 960 - 100 = 860.
    expect(result.snappedX).toBe(860);
    expect(result.guides.some((g) => g.kind === "v" && g.pos === 960)).toBe(true);
  });

  it("snaps to canvas vertical center", () => {
    const result = computeAlignmentGuides(
      { x: 100, y: 489, width: 200, height: 100 },
      [],
      canvas,
    );
    // canvas vertical center = 540, dragged center = 489 + 50 = 539.
    expect(result.snappedY).toBe(490);
    expect(result.guides.some((g) => g.kind === "h" && g.pos === 540)).toBe(true);
  });

  it("does not snap when distance > snap threshold", () => {
    const result = computeAlignmentGuides(
      { x: 510, y: 200, width: 100, height: 50 },
      [{ id: "o1", transform: { x: 500, y: 100, width: 100, height: 50 } }],
      canvas,
    );
    expect(result.snappedX).toBe(510);
  });

  it("shows guide but does not snap when within proximity but outside snap threshold", () => {
    const result = computeAlignmentGuides(
      { x: 504, y: 200, width: 100, height: 50 },
      [{ id: "o1", transform: { x: 500, y: 100, width: 100, height: 50 } }],
      canvas,
    );
    // 4px from match — outside SNAP=3 but inside PROXIMITY=5.
    expect(result.snappedX).toBe(504);
    expect(result.guides.some((g) => g.kind === "v" && g.pos === 500)).toBe(true);
  });

  it("matches right edge to right edge", () => {
    const result = computeAlignmentGuides(
      { x: 401, y: 200, width: 100, height: 50 },
      [{ id: "o1", transform: { x: 400, y: 100, width: 100, height: 50 } }],
      canvas,
    );
    // dragged.right = 501, other.right = 500. snap to other.right → dragged.x = 400.
    expect(result.snappedX).toBe(400);
  });
});
