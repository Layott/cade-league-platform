import { describe, it, expect } from "vitest";
import { computeAlphaBoundingBox, computeCardCropTransform } from "./photo-card-crop";

describe("photo-card-crop", () => {
  it("computeAlphaBoundingBox finds opaque region", () => {
    // 4×4 image: only pixel (1,1) opaque
    const data = new Uint8ClampedArray(4 * 4 * 4);
    data[(1 * 4 + 1) * 4 + 3] = 255; // alpha
    const bbox = computeAlphaBoundingBox(data, 4, 4, 1);
    expect(bbox).toEqual({ x: 1, y: 1, w: 1, h: 1 });
  });

  it("computeAlphaBoundingBox returns null when fully transparent", () => {
    const data = new Uint8ClampedArray(4 * 4 * 4); // all zero alpha
    const bbox = computeAlphaBoundingBox(data, 4, 4);
    expect(bbox).toBeNull();
  });

  it("computeAlphaBoundingBox respects alpha threshold", () => {
    // Two opaque-ish pixels: one below threshold (10), one above (200)
    const data = new Uint8ClampedArray(4 * 4 * 4);
    data[(0 * 4 + 0) * 4 + 3] = 10; // below default threshold (16)
    data[(2 * 4 + 2) * 4 + 3] = 200; // above
    const bbox = computeAlphaBoundingBox(data, 4, 4);
    expect(bbox).toEqual({ x: 2, y: 2, w: 1, h: 1 });
  });

  it("computeAlphaBoundingBox finds a contiguous opaque rectangle", () => {
    // 6×6 canvas with a 3×2 opaque block at (1,2)..(3,3)
    const W = 6;
    const H = 6;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 2; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) {
        data[(y * W + x) * 4 + 3] = 255;
      }
    }
    const bbox = computeAlphaBoundingBox(data, W, H);
    expect(bbox).toEqual({ x: 1, y: 2, w: 3, h: 2 });
  });

  it("computeCardCropTransform centers + scales subject into 4:5 with padding", () => {
    const t = computeCardCropTransform({
      bbox: { x: 100, y: 100, w: 400, h: 800 },
      target: { w: 1080, h: 1350 },
      paddingPct: 0.08,
    });
    // Subject is 400×800 (1:2), target is 1080×1350 (4:5), padding 8%.
    // Subject height (800) is the limiting dimension since target aspect is wider than subject's content.
    expect(t.scale).toBeCloseTo((1350 * (1 - 0.08 * 2)) / 800, 3);
    expect(t.dx + t.scale * 100).toBeGreaterThan(0); // subject centered horizontally
  });

  it("computeCardCropTransform centers a subject horizontally and vertically inside the target", () => {
    const t = computeCardCropTransform({
      bbox: { x: 100, y: 100, w: 400, h: 800 },
      target: { w: 1080, h: 1350 },
      paddingPct: 0.08,
    });
    // After applying transform: subject midpoint maps to target midpoint.
    const subjectCenterX = 100 + 400 / 2;
    const subjectCenterY = 100 + 800 / 2;
    const mappedCenterX = t.dx + t.scale * subjectCenterX;
    const mappedCenterY = t.dy + t.scale * subjectCenterY;
    expect(mappedCenterX).toBeCloseTo(1080 / 2, 3);
    expect(mappedCenterY).toBeCloseTo(1350 / 2, 3);
  });

  it("computeCardCropTransform with width-limited subject scales to inner width", () => {
    // Wide subject (1:1 aspect) — width becomes the limit relative to a 4:5 (taller) target.
    const t = computeCardCropTransform({
      bbox: { x: 0, y: 0, w: 1000, h: 1000 },
      target: { w: 1080, h: 1350 },
      paddingPct: 0.08,
    });
    expect(t.scale).toBeCloseTo((1080 * (1 - 0.08 * 2)) / 1000, 3);
  });
});
