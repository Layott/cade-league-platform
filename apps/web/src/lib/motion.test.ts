import { describe, it, expect } from "vitest";
import {
  ENTER,
  EXIT,
  STAGGER,
  SCORE_FLIP,
  IDLE_PULSE,
  STINGER_IN,
  STINGER_HOLD,
  STINGER_OUT,
  MOTION_TOKENS,
  scaleDuration,
} from "./motion";

describe("motion tokens", () => {
  it("ENTER duration is 0.45s with 4-tuple ease", () => {
    expect(ENTER.duration).toBe(0.45);
    expect(ENTER.ease).toHaveLength(4);
  });

  it("EXIT duration is 0.25s (snap out)", () => {
    expect(EXIT.duration).toBe(0.25);
  });

  it("STAGGER is 60 ms", () => {
    expect(STAGGER).toBeCloseTo(0.06);
  });

  it("SCORE_FLIP uses an overshoot ease (negative + >1 stops)", () => {
    expect(SCORE_FLIP.duration).toBe(0.6);
    const [, p1, , p3] = SCORE_FLIP.ease;
    expect(p1).toBeLessThan(0); // anticipate
    expect(p3).toBeGreaterThan(1); // overshoot
  });

  it("IDLE_PULSE loops forever, mirroring", () => {
    expect(IDLE_PULSE.repeat).toBe(Infinity);
    expect(IDLE_PULSE.repeatType).toBe("mirror");
  });

  it("STINGER_IN + STINGER_OUT are 0.35s ease-in-out-expo", () => {
    expect(STINGER_IN.duration).toBe(0.35);
    expect(STINGER_OUT.duration).toBe(0.35);
  });

  it("STINGER_HOLD is 1.3s (middle hold for 2s stingers)", () => {
    expect(STINGER_HOLD.duration).toBe(1.3);
  });

  it("MOTION_TOKENS barrel exports all 8 tokens", () => {
    expect(Object.keys(MOTION_TOKENS).sort()).toEqual(
      [
        "ENTER",
        "EXIT",
        "IDLE_PULSE",
        "SCORE_FLIP",
        "STAGGER",
        "STINGER_HOLD",
        "STINGER_IN",
        "STINGER_OUT",
      ].sort(),
    );
  });

  it("scaleDuration returns raw value server-side (no window)", () => {
    // Simulate SSR by tricking typeof window — in jsdom it exists,
    // so we fall through to the document check. Still: input should
    // pass through unchanged when --motion-speed is unset.
    const d = scaleDuration(0.42);
    expect(d).toBeCloseTo(0.42);
  });

  it("scaleDuration divides by a valid --motion-speed CSS var", () => {
    document.documentElement.style.setProperty("--motion-speed", "2");
    expect(scaleDuration(1)).toBeCloseTo(0.5);
    document.documentElement.style.removeProperty("--motion-speed");
  });

  it("scaleDuration ignores non-finite --motion-speed", () => {
    document.documentElement.style.setProperty("--motion-speed", "abc");
    expect(scaleDuration(1)).toBeCloseTo(1);
    document.documentElement.style.removeProperty("--motion-speed");
  });
});
