import { describe, expect, it } from "vitest";
import { validateAnimation } from "./animation-validator";

describe("validateAnimation — happy paths", () => {
  it("accepts a single-phase entry slide-left", () => {
    const r = validateAnimation({
      entry: {
        type: "slide-left",
        durationMs: 360,
        delayMs: 0,
        easing: "ease-out",
      },
    });
    expect(r.ok).toBe(true);
  });

  it("accepts a fully-populated 3-phase animation", () => {
    const r = validateAnimation({
      entry: { type: "fade", durationMs: 240, delayMs: 0, easing: "ease-out" },
      exit: { type: "fade", durationMs: 240, delayMs: 0, easing: "ease-in" },
      loop: { type: "pulse", durationMs: 1200, delayMs: 0, easing: "ease-in-out" },
    });
    expect(r.ok).toBe(true);
  });

  it("accepts cubic-bezier easing", () => {
    const r = validateAnimation({
      entry: {
        type: "bounce",
        durationMs: 600,
        delayMs: 0,
        easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
    });
    expect(r.ok).toBe(true);
  });

  it("accepts a valid custom-css keyframes body", () => {
    const r = validateAnimation({
      entry: {
        type: "custom-css",
        durationMs: 600,
        delayMs: 0,
        easing: "ease-out",
        keyframesBody: "0% { opacity: 0 } 100% { opacity: 1 }",
      },
    });
    expect(r.ok).toBe(true);
  });

  it("accepts empty animation (no phases)", () => {
    const r = validateAnimation({});
    expect(r.ok).toBe(true);
  });
});

describe("validateAnimation — rejection paths", () => {
  it("rejects unknown animation type", () => {
    const r = validateAnimation({
      entry: {
        type: "explode",
        durationMs: 200,
        delayMs: 0,
        easing: "ease-out",
      },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects broken easing string", () => {
    const r = validateAnimation({
      entry: {
        type: "fade",
        durationMs: 200,
        delayMs: 0,
        easing: "ease-into-the-void",
      },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects negative durationMs", () => {
    const r = validateAnimation({
      entry: {
        type: "fade",
        durationMs: -100,
        delayMs: 0,
        easing: "ease-out",
      },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects durationMs greater than 30000", () => {
    const r = validateAnimation({
      entry: {
        type: "fade",
        durationMs: 30001,
        delayMs: 0,
        easing: "ease-out",
      },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects custom-css with disallowed CSS property", () => {
    const r = validateAnimation({
      entry: {
        type: "custom-css",
        durationMs: 600,
        delayMs: 0,
        easing: "ease-out",
        keyframesBody: "0% { width: 0px } 100% { width: 200px }",
      },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects custom-css missing keyframesBody payload", () => {
    const r = validateAnimation({
      entry: {
        type: "custom-css",
        durationMs: 600,
        delayMs: 0,
        easing: "ease-out",
      },
    });
    expect(r.ok).toBe(false);
  });
});

describe("validateAnimation — Wave 3B advanced timeline", () => {
  it("accepts advanced opacity track with 2 keyframes inside duration", () => {
    const r = validateAnimation({
      entry: {
        type: "noop",
        durationMs: 600,
        delayMs: 0,
        easing: "linear",
        advancedTimeline: [
          {
            property: "opacity",
            keyframes: [
              { id: "k1", timeMs: 0, value: 0, easingOut: null },
              { id: "k2", timeMs: 600, value: 1, easingOut: null },
            ],
          },
        ],
      },
    });
    expect(r.ok).toBe(true);
  });

  it("accepts multi-property advanced timeline (opacity + x + scaleX)", () => {
    const r = validateAnimation({
      entry: {
        type: "noop",
        durationMs: 1000,
        delayMs: 0,
        easing: "linear",
        advancedTimeline: [
          {
            property: "opacity",
            keyframes: [
              { id: "o1", timeMs: 0, value: 0, easingOut: null },
              { id: "o2", timeMs: 1000, value: 1, easingOut: null },
            ],
          },
          {
            property: "x",
            keyframes: [
              { id: "x1", timeMs: 0, value: -120, easingOut: { x1: 0.4, y1: 0, x2: 0.6, y2: 1 } },
              { id: "x2", timeMs: 1000, value: 0, easingOut: null },
            ],
          },
          {
            property: "scaleX",
            keyframes: [
              { id: "s1", timeMs: 0, value: 0.8, easingOut: null },
              { id: "s2", timeMs: 500, value: 1.1, easingOut: null },
              { id: "s3", timeMs: 1000, value: 1, easingOut: null },
            ],
          },
        ],
      },
    });
    expect(r.ok).toBe(true);
  });

  it("rejects non-monotonic keyframe times", () => {
    const r = validateAnimation({
      entry: {
        type: "noop",
        durationMs: 600,
        delayMs: 0,
        easing: "linear",
        advancedTimeline: [
          {
            property: "opacity",
            keyframes: [
              { id: "k1", timeMs: 0, value: 0, easingOut: null },
              { id: "k2", timeMs: 600, value: 1, easingOut: null },
              { id: "k3", timeMs: 300, value: 0.5, easingOut: null }, // out of order
            ],
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join("|")).toMatch(/monotonic|order/i);
    }
  });

  it("rejects keyframe time greater than phase durationMs", () => {
    const r = validateAnimation({
      entry: {
        type: "noop",
        durationMs: 600,
        delayMs: 0,
        easing: "linear",
        advancedTimeline: [
          {
            property: "opacity",
            keyframes: [
              { id: "k1", timeMs: 0, value: 0, easingOut: null },
              { id: "k2", timeMs: 9000, value: 1, easingOut: null },
            ],
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join("|")).toMatch(/durationMs|range/i);
    }
  });

  it("rejects numeric value on color property", () => {
    const r = validateAnimation({
      entry: {
        type: "noop",
        durationMs: 600,
        delayMs: 0,
        easing: "linear",
        advancedTimeline: [
          {
            property: "color",
            keyframes: [
              { id: "k1", timeMs: 0, value: 0.5, easingOut: null }, // wrong type
              { id: "k2", timeMs: 600, value: "#fe036d", easingOut: null },
            ],
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join("|")).toMatch(/color.*string|value.*type/i);
    }
  });

  it("rejects string value on opacity property", () => {
    const r = validateAnimation({
      entry: {
        type: "noop",
        durationMs: 600,
        delayMs: 0,
        easing: "linear",
        advancedTimeline: [
          {
            property: "opacity",
            keyframes: [
              { id: "k1", timeMs: 0, value: "zero", easingOut: null },
              { id: "k2", timeMs: 600, value: 1, easingOut: null },
            ],
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects opacity values outside [0, 1]", () => {
    const r = validateAnimation({
      entry: {
        type: "noop",
        durationMs: 600,
        delayMs: 0,
        easing: "linear",
        advancedTimeline: [
          {
            property: "opacity",
            keyframes: [
              { id: "k1", timeMs: 0, value: -0.2, easingOut: null },
              { id: "k2", timeMs: 600, value: 1.5, easingOut: null },
            ],
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects mutual-exclusivity violation (preset type AND advanced timeline)", () => {
    const r = validateAnimation({
      entry: {
        type: "slide-left",
        durationMs: 600,
        delayMs: 0,
        easing: "ease-out",
        advancedTimeline: [
          {
            property: "opacity",
            keyframes: [
              { id: "k1", timeMs: 0, value: 0, easingOut: null },
              { id: "k2", timeMs: 600, value: 1, easingOut: null },
            ],
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join("|")).toMatch(/mutual|exclusive|both/i);
    }
  });

  it("rejects duplicate keyframe times within a track", () => {
    const r = validateAnimation({
      entry: {
        type: "noop",
        durationMs: 600,
        delayMs: 0,
        easing: "linear",
        advancedTimeline: [
          {
            property: "opacity",
            keyframes: [
              { id: "k1", timeMs: 300, value: 0, easingOut: null },
              { id: "k2", timeMs: 300, value: 1, easingOut: null },
            ],
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join("|")).toMatch(/duplicate|distinct/i);
    }
  });
});
