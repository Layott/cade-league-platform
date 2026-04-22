import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { resolveSoundUrl, useOverlaySound } from "./overlay-sound";

describe("resolveSoundUrl", () => {
  it("maps each slot to a wav path", () => {
    expect(resolveSoundUrl("stinger-intro")).toMatch(/intro_long\.wav$/);
    expect(resolveSoundUrl("stinger-normal")).toMatch(/stinger_normal\.wav$/);
    expect(resolveSoundUrl("stinger-goal")).toMatch(/stinger_goal\.wav$/);
    expect(resolveSoundUrl("whoosh-short")).toMatch(/trigger_in\.wav$/);
    expect(resolveSoundUrl("tick-1s")).toMatch(/timer_tick\.wav$/);
  });

  it("returns null for missing / undefined slot", () => {
    expect(resolveSoundUrl(null)).toBeNull();
    expect(resolveSoundUrl(undefined)).toBeNull();
  });
});

describe("useOverlaySound", () => {
  beforeEach(() => {
    // Strip any ?mute= that previous test left.
    window.history.replaceState({}, "", "/");
    // stub HTMLMediaElement.play so audio element methods don't throw.
    // jsdom doesn't implement media playback.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).HTMLMediaElement.prototype.play = () =>
      Promise.resolve();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).HTMLMediaElement.prototype.pause = () => undefined;
  });

  it("returns ready=true with valid slot", () => {
    const { result } = renderHook(() => useOverlaySound("stinger-normal", 1));
    expect(result.current.ready).toBe(true);
    expect(result.current.url).toMatch(/stinger_normal\.wav$/);
  });

  it("returns ready=false when slot is null", () => {
    const { result } = renderHook(() => useOverlaySound(null, 1));
    expect(result.current.ready).toBe(false);
    expect(result.current.url).toBeNull();
  });

  it("respects localStorage mute flag", () => {
    const orig = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => (k === "overlay-sound-muted" ? "1" : null),
        setItem: () => undefined,
        removeItem: () => undefined,
        clear: () => undefined,
        key: () => null,
        length: 0,
      },
    });
    try {
      const { result, rerender } = renderHook(
        ({ t }: { t: number }) => useOverlaySound("stinger-normal", t),
        { initialProps: { t: 0 } },
      );
      rerender({ t: 1 });
      expect(result.current.muted).toBe(true);
    } finally {
      if (orig) Object.defineProperty(window, "localStorage", orig);
    }
  });

  it("respects ?mute=1 query flag", () => {
    window.history.replaceState({}, "", "/?mute=1");
    const { result, rerender } = renderHook(
      ({ t }: { t: number }) => useOverlaySound("stinger-goal", t),
      { initialProps: { t: 0 } },
    );
    rerender({ t: 1 });
    expect(result.current.muted).toBe(true);
  });
});
