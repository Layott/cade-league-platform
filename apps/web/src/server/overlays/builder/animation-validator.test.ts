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
