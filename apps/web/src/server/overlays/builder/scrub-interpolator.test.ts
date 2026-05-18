/**
 * Unit tests — scrub-preview interpolator.
 *
 * Spec: docs/superpowers/plans/2026-05-17-overlay-builder-wave-3b.md
 *       (Task 13).
 */

import { describe, expect, it } from "vitest";

import {
  cubicBezierProgress,
  interpolateAt,
  interpolateAtMs,
} from "./scrub-interpolator";
import type { AdvancedTimeline, BezierEasing } from "./types";

// ── Fixture timelines ────────────────────────────────────────────────

const LINEAR_TL: AdvancedTimeline = [
  {
    property: "opacity",
    keyframes: [
      { id: "a", timeMs: 0, value: 0, easingOut: null },
      { id: "b", timeMs: 1000, value: 1, easingOut: null },
    ],
  },
  {
    property: "x",
    keyframes: [
      { id: "c", timeMs: 0, value: -120, easingOut: null },
      { id: "d", timeMs: 500, value: 0, easingOut: null },
      { id: "e", timeMs: 1000, value: 60, easingOut: null },
    ],
  },
  {
    property: "color",
    keyframes: [
      { id: "f", timeMs: 0, value: "#000000", easingOut: null },
      { id: "g", timeMs: 1000, value: "#ffffff", easingOut: null },
    ],
  },
];

// ── interpolateAt — bounds + linear segments ─────────────────────────

describe("interpolateAt — endpoint snap", () => {
  it("returns first-keyframe values when cursor is at start", () => {
    expect(interpolateAt(LINEAR_TL, 0)).toMatchObject({
      opacity: 0,
      x: -120,
      color: "#000000",
    });
  });

  it("returns last-keyframe values when cursor is at end", () => {
    expect(interpolateAt(LINEAR_TL, 1000)).toMatchObject({
      opacity: 1,
      x: 60,
      color: "#ffffff",
    });
  });

  it("clamps to first keyframe when cursor is before start", () => {
    expect(interpolateAt(LINEAR_TL, -500)).toMatchObject({
      opacity: 0,
      x: -120,
      color: "#000000",
    });
  });

  it("clamps to last keyframe when cursor is past end", () => {
    expect(interpolateAt(LINEAR_TL, 99_999)).toMatchObject({
      opacity: 1,
      x: 60,
      color: "#ffffff",
    });
  });
});

describe("interpolateAt — linear interpolation (no easingOut)", () => {
  it("interpolates opacity at 25% of a single segment", () => {
    expect(interpolateAt(LINEAR_TL, 250).opacity).toBeCloseTo(0.25, 6);
  });

  it("interpolates opacity at 50% of a single segment", () => {
    expect(interpolateAt(LINEAR_TL, 500).opacity).toBeCloseTo(0.5, 6);
  });

  it("respects multi-segment x track — first half", () => {
    // x runs -120 → 0 from 0..500ms. At 250ms (50% of segment) → -60.
    expect(interpolateAt(LINEAR_TL, 250).x).toBeCloseTo(-60, 6);
  });

  it("respects multi-segment x track — second half", () => {
    // x runs 0 → 60 from 500..1000ms. At 750ms (50% of segment) → 30.
    expect(interpolateAt(LINEAR_TL, 750).x).toBeCloseTo(30, 6);
  });

  it("returns exact keyframe value at internal keyframe boundary", () => {
    // Middle keyframe of x track sits at 500ms with value 0.
    expect(interpolateAt(LINEAR_TL, 500).x).toBeCloseTo(0, 6);
  });
});

// ── interpolateAt — string properties snap to prior keyframe ────────

describe("interpolateAt — string properties snap to prior keyframe", () => {
  it("holds prior color value between keyframes", () => {
    expect(interpolateAt(LINEAR_TL, 250).color).toBe("#000000");
    expect(interpolateAt(LINEAR_TL, 500).color).toBe("#000000");
    expect(interpolateAt(LINEAR_TL, 999).color).toBe("#000000");
  });

  it("snaps to next color value exactly at its keyframe", () => {
    expect(interpolateAt(LINEAR_TL, 1000).color).toBe("#ffffff");
  });

  it("handles filter strings the same way", () => {
    const tl: AdvancedTimeline = [
      {
        property: "filter",
        keyframes: [
          { id: "a", timeMs: 0, value: "blur(0px)", easingOut: null },
          { id: "b", timeMs: 1000, value: "blur(8px)", easingOut: null },
        ],
      },
    ];
    expect(interpolateAt(tl, 0).filter).toBe("blur(0px)");
    expect(interpolateAt(tl, 500).filter).toBe("blur(0px)"); // snap
    expect(interpolateAt(tl, 1000).filter).toBe("blur(8px)");
  });
});

// ── interpolateAt — bezier-eased segments ────────────────────────────

describe("interpolateAt — bezier easingOut", () => {
  // Classic "ease-out" — fast start, slow finish. At t = 0.5 the
  // CSS-spec curve resolves to ≈ 0.802, so a 0→100 segment should
  // sit well above 50 at the midpoint.
  const easeOut: BezierEasing = { x1: 0, y1: 0, x2: 0.58, y2: 1 };

  const tl: AdvancedTimeline = [
    {
      property: "opacity",
      keyframes: [
        { id: "a", timeMs: 0, value: 0, easingOut: easeOut },
        { id: "b", timeMs: 1000, value: 1, easingOut: null },
      ],
    },
  ];

  it("eases past the linear midpoint for ease-out curve", () => {
    const v = interpolateAt(tl, 500).opacity!;
    // Past linear midpoint, well under 1.
    expect(v).toBeGreaterThan(0.55);
    expect(v).toBeLessThan(0.95);
  });

  it("still snaps to keyframe values at exact boundaries", () => {
    expect(interpolateAt(tl, 0).opacity).toBe(0);
    expect(interpolateAt(tl, 1000).opacity).toBe(1);
  });

  it("ease-in curve sits below linear at midpoint", () => {
    const easeIn: BezierEasing = { x1: 0.42, y1: 0, x2: 1, y2: 1 };
    const easeInTl: AdvancedTimeline = [
      {
        property: "opacity",
        keyframes: [
          { id: "a", timeMs: 0, value: 0, easingOut: easeIn },
          { id: "b", timeMs: 1000, value: 1, easingOut: null },
        ],
      },
    ];
    const v = interpolateAt(easeInTl, 500).opacity!;
    expect(v).toBeLessThan(0.45);
    expect(v).toBeGreaterThan(0.05);
  });
});

// ── interpolateAt — multi-property merge ─────────────────────────────

describe("interpolateAt — multi-property merge", () => {
  it("emits one patch entry per animated property", () => {
    const r = interpolateAt(LINEAR_TL, 250);
    expect(Object.keys(r).sort()).toEqual(["color", "opacity", "x"]);
  });

  it("omits properties absent from the timeline", () => {
    const r = interpolateAt(LINEAR_TL, 250);
    expect(r.y).toBeUndefined();
    expect(r.scaleX).toBeUndefined();
    expect(r.rotation).toBeUndefined();
    expect(r.filter).toBeUndefined();
  });

  it("handles every animatable numeric property", () => {
    const tl: AdvancedTimeline = (
      ["opacity", "x", "y", "scaleX", "scaleY", "rotation"] as const
    ).map((property) => ({
      property,
      keyframes: [
        { id: `${property}-a`, timeMs: 0, value: 0, easingOut: null },
        { id: `${property}-b`, timeMs: 1000, value: 10, easingOut: null },
      ],
    }));
    const r = interpolateAt(tl, 500);
    expect(r.opacity).toBeCloseTo(5, 6);
    expect(r.x).toBeCloseTo(5, 6);
    expect(r.y).toBeCloseTo(5, 6);
    expect(r.scaleX).toBeCloseTo(5, 6);
    expect(r.scaleY).toBeCloseTo(5, 6);
    expect(r.rotation).toBeCloseTo(5, 6);
  });
});

// ── interpolateAt — empty / edge inputs ──────────────────────────────

describe("interpolateAt — edge inputs", () => {
  it("returns an empty patch for an empty timeline", () => {
    expect(interpolateAt([], 500)).toEqual({});
  });

  it("snaps when prev and next share a timeMs (degenerate segment)", () => {
    // Authoring tools shouldn't produce this but the resolver must not
    // divide by zero if they do.
    const tl: AdvancedTimeline = [
      {
        property: "opacity",
        keyframes: [
          { id: "a", timeMs: 0, value: 0, easingOut: null },
          { id: "b", timeMs: 500, value: 0.5, easingOut: null },
          { id: "c", timeMs: 500, value: 0.9, easingOut: null },
          { id: "d", timeMs: 1000, value: 1, easingOut: null },
        ],
      },
    ];
    // Cursor lands inside the zero-width [b, c] segment — snap to b.
    // We can't actually land "between" two keyframes with equal timeMs;
    // this asserts no NaN / Infinity leaks out for any timeMs in range.
    const r = interpolateAt(tl, 500);
    expect(typeof r.opacity).toBe("number");
    expect(Number.isFinite(r.opacity)).toBe(true);
  });
});

// ── interpolateAtMs — backwards-compat alias ─────────────────────────

describe("interpolateAtMs — alias", () => {
  it("is the same function as interpolateAt", () => {
    expect(interpolateAtMs).toBe(interpolateAt);
  });

  it("returns equivalent results", () => {
    expect(interpolateAtMs(LINEAR_TL, 250)).toEqual(
      interpolateAt(LINEAR_TL, 250),
    );
  });
});

// ── cubicBezierProgress — standalone curve evaluation ────────────────

describe("cubicBezierProgress", () => {
  it("returns 0 at progress 0 and 1 at progress 1 for any curve", () => {
    const curve: BezierEasing = { x1: 0.42, y1: 0, x2: 0.58, y2: 1 };
    expect(cubicBezierProgress(curve, 0)).toBe(0);
    expect(cubicBezierProgress(curve, 1)).toBe(1);
  });

  it("clamps to 0 for negative progress and 1 for progress > 1", () => {
    const curve: BezierEasing = { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 };
    expect(cubicBezierProgress(curve, -0.5)).toBe(0);
    expect(cubicBezierProgress(curve, 1.5)).toBe(1);
  });

  it("is the identity on the linear curve (0,0,1,1)", () => {
    const linear: BezierEasing = { x1: 0, y1: 0, x2: 1, y2: 1 };
    expect(cubicBezierProgress(linear, 0.25)).toBeCloseTo(0.25, 6);
    expect(cubicBezierProgress(linear, 0.5)).toBeCloseTo(0.5, 6);
    expect(cubicBezierProgress(linear, 0.75)).toBeCloseTo(0.75, 6);
  });

  it("is monotonically non-decreasing across a typical ease curve", () => {
    const curve: BezierEasing = { x1: 0.42, y1: 0, x2: 0.58, y2: 1 };
    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const y = cubicBezierProgress(curve, i / 20);
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
  });

  it("ease-out curve sits above linear at the midpoint", () => {
    const easeOut: BezierEasing = { x1: 0, y1: 0, x2: 0.58, y2: 1 };
    expect(cubicBezierProgress(easeOut, 0.5)).toBeGreaterThan(0.5);
  });

  it("ease-in curve sits below linear at the midpoint", () => {
    const easeIn: BezierEasing = { x1: 0.42, y1: 0, x2: 1, y2: 1 };
    expect(cubicBezierProgress(easeIn, 0.5)).toBeLessThan(0.5);
  });
});
