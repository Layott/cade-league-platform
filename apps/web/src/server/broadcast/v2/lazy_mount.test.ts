import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeFallbackDelay,
  createLazyMountController,
  lazyMountStageStyle,
} from "./lazy_mount";

describe("computeFallbackDelay()", () => {
  it("uses base delay when target.top is 0", () => {
    const target = {
      getBoundingClientRect: () => ({ top: 0 }),
    } as unknown as Element;
    expect(computeFallbackDelay(target, 400, 0.4, 2400)).toBe(400);
  });

  it("scales by rectMultiplier for non-zero top", () => {
    const target = {
      getBoundingClientRect: () => ({ top: 1000 }),
    } as unknown as Element;
    expect(computeFallbackDelay(target, 400, 0.4, 2400)).toBe(400 + 400);
  });

  it("clamps extra delay at maxExtraDelay", () => {
    const target = {
      getBoundingClientRect: () => ({ top: 100000 }),
    } as unknown as Element;
    expect(computeFallbackDelay(target, 400, 0.4, 2400)).toBe(400 + 2400);
  });

  it("treats negative top as 0 extra delay", () => {
    const target = {
      getBoundingClientRect: () => ({ top: -200 }),
    } as unknown as Element;
    expect(computeFallbackDelay(target, 400, 0.4, 2400)).toBe(400);
  });

  it("falls back to base when getBoundingClientRect throws", () => {
    const target = {
      getBoundingClientRect: () => {
        throw new Error("nope");
      },
    } as unknown as Element;
    expect(computeFallbackDelay(target, 500, 0.4, 2400)).toBe(500);
  });
});

describe("lazyMountStageStyle()", () => {
  it("emits content-visibility + contain-intrinsic-size with default header", () => {
    const style = lazyMountStageStyle({ tileWidth: 320, tileHeight: 180 });
    expect(style.contentVisibility).toBe("auto");
    expect(style.containIntrinsicSize).toBe("208px 320px");
  });

  it("uses compactHeader=true offset (22) instead of default (28)", () => {
    const style = lazyMountStageStyle({
      tileWidth: 320,
      tileHeight: 180,
      compactHeader: true,
    });
    expect(style.containIntrinsicSize).toBe("202px 320px");
  });
});

describe("createLazyMountController()", () => {
  let mockObserve: ReturnType<typeof vi.fn>;
  let mockDisconnect: ReturnType<typeof vi.fn>;
  let observerCallback: IntersectionObserverCallback | null = null;
  let originalIO: typeof IntersectionObserver | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    mockObserve = vi.fn();
    mockDisconnect = vi.fn();
    originalIO = (globalThis as { IntersectionObserver?: typeof IntersectionObserver })
      .IntersectionObserver;
    class MockIO {
      constructor(cb: IntersectionObserverCallback) {
        observerCallback = cb;
      }
      observe = mockObserve;
      disconnect = mockDisconnect;
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);
      root: Element | null = null;
      rootMargin = "";
      thresholds: ReadonlyArray<number> = [];
    }
    (globalThis as Record<string, unknown>).IntersectionObserver =
      MockIO as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalIO) {
      (globalThis as Record<string, unknown>).IntersectionObserver = originalIO;
    } else {
      delete (globalThis as Record<string, unknown>).IntersectionObserver;
    }
    observerCallback = null;
  });

  it("calls onMount when target intersects", () => {
    const onMount = vi.fn();
    const target = {
      getBoundingClientRect: () => ({ top: 0 }),
    } as unknown as Element;
    createLazyMountController({ target, onMount });
    expect(mockObserve).toHaveBeenCalledWith(target);
    expect(onMount).not.toHaveBeenCalled();
    // simulate intersection
    if (observerCallback) {
      observerCallback(
        [{ isIntersecting: true } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    }
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it("calls onMount via fallback timer when no intersection happens", () => {
    const onMount = vi.fn();
    const target = {
      getBoundingClientRect: () => ({ top: 0 }),
    } as unknown as Element;
    createLazyMountController({ target, onMount });
    vi.advanceTimersByTime(450);
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it("does not call onMount more than once even on multiple intersections", () => {
    const onMount = vi.fn();
    const target = {
      getBoundingClientRect: () => ({ top: 0 }),
    } as unknown as Element;
    createLazyMountController({ target, onMount });
    if (observerCallback) {
      observerCallback(
        [{ isIntersecting: true } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      observerCallback(
        [{ isIntersecting: true } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    }
    vi.advanceTimersByTime(2000);
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it("destroy() stops further mount calls + disconnects observer", () => {
    const onMount = vi.fn();
    const target = {
      getBoundingClientRect: () => ({ top: 0 }),
    } as unknown as Element;
    const ctrl = createLazyMountController({ target, onMount });
    ctrl.destroy();
    if (observerCallback) {
      observerCallback(
        [{ isIntersecting: true } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    }
    vi.advanceTimersByTime(2000);
    expect(onMount).not.toHaveBeenCalled();
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it("falls back to eager mount when IntersectionObserver is undefined", () => {
    delete (globalThis as Record<string, unknown>).IntersectionObserver;
    const onMount = vi.fn();
    const target = {
      getBoundingClientRect: () => ({ top: 0 }),
    } as unknown as Element;
    createLazyMountController({ target, onMount });
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it("ignores non-intersecting entries", () => {
    const onMount = vi.fn();
    const target = {
      getBoundingClientRect: () => ({ top: 0 }),
    } as unknown as Element;
    createLazyMountController({ target, onMount });
    if (observerCallback) {
      observerCallback(
        [{ isIntersecting: false } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    }
    expect(onMount).not.toHaveBeenCalled();
  });

  it("disconnects observer + clears timer once mounted", () => {
    const onMount = vi.fn();
    const target = {
      getBoundingClientRect: () => ({ top: 0 }),
    } as unknown as Element;
    createLazyMountController({ target, onMount });
    if (observerCallback) {
      observerCallback(
        [{ isIntersecting: true } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    }
    expect(mockDisconnect).toHaveBeenCalled();
  });
});
