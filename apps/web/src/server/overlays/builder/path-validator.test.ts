import { describe, expect, it } from "vitest";
import { validatePath } from "./path-validator";

const okNode = (x: number, y: number) => ({
  x, y, ctrlInX: x, ctrlInY: y, ctrlOutX: x, ctrlOutY: y,
});

describe("path-validator — happy paths", () => {
  it("accepts a 2-node straight line", () => {
    const r = validatePath({ nodes: [okNode(0, 0), okNode(100, 100)], closed: false });
    expect(r.ok).toBe(true);
  });

  it("accepts a 4-node closed quadrilateral", () => {
    const r = validatePath({
      nodes: [okNode(0, 0), okNode(100, 0), okNode(100, 100), okNode(0, 100)],
      closed: true,
    });
    expect(r.ok).toBe(true);
  });

  it("accepts cubic-Bezier handles distinct from anchors", () => {
    const r = validatePath({
      nodes: [
        { x: 0, y: 0, ctrlInX: 0, ctrlInY: 0, ctrlOutX: 50, ctrlOutY: -50 },
        { x: 100, y: 100, ctrlInX: 50, ctrlInY: 150, ctrlOutX: 100, ctrlOutY: 100 },
      ],
      closed: false,
    });
    expect(r.ok).toBe(true);
  });
});

describe("path-validator — rejections", () => {
  it("rejects under-2 nodes", () => {
    const r = validatePath({ nodes: [okNode(0, 0)], closed: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/2 nodes/i);
  });

  it("rejects NaN coordinates", () => {
    const r = validatePath({
      nodes: [okNode(0, 0), { x: NaN, y: 50, ctrlInX: 0, ctrlInY: 0, ctrlOutX: 0, ctrlOutY: 0 }],
      closed: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/nan|finite/i);
  });

  it("rejects Infinity coordinates", () => {
    const r = validatePath({
      nodes: [okNode(0, 0), { x: Infinity, y: 50, ctrlInX: 0, ctrlInY: 0, ctrlOutX: 0, ctrlOutY: 0 }],
      closed: false,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects coordinates outside canvas bounds with bounds option", () => {
    const r = validatePath(
      { nodes: [okNode(0, 0), okNode(99999, 50)], closed: false },
      { maxX: 1920, maxY: 1080 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/bounds|canvas/i);
  });

  it("rejects more than 500 nodes", () => {
    const nodes = Array.from({ length: 501 }, (_, i) => okNode(i, i));
    const r = validatePath({ nodes, closed: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/500|too many/i);
  });

  it("rejects non-object payload (string)", () => {
    const r = validatePath("M 0 0 L 100 100" as unknown);
    expect(r.ok).toBe(false);
  });

  it("rejects payload missing nodes field", () => {
    const r = validatePath({ closed: false } as unknown);
    expect(r.ok).toBe(false);
  });
});
