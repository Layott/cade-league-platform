/**
 * Plan 51 — broadcast v2 lazy-mount utilities.
 *
 * Extracted from `apps/web/src/components/broadcast/OverlayMiniPreview.tsx`
 * (Plan 48.4). The hardened algorithm:
 *
 *  1. IntersectionObserver gates iframe mount until the tile is within
 *     `rootMargin: "200px 0px"` of the viewport.
 *  2. Fallback timer (`baseDelay + extraDelay`) guarantees mount even when
 *     the tile never scrolls into view (e.g. off-screen editable panels,
 *     E2E specs that bypass scroll).
 *  3. Once mounted, the iframe stays mounted -> no scroll re-creation that
 *     would drop the WebSocket subscription.
 *  4. `content-visibility: auto` skips paint+layout for off-screen tiles.
 *
 * Lifted into a pure module so the broadcast v2 control panel + the
 * overlay routes themselves can both reuse the logic without each
 * re-implementing the IO + delay dance.
 */

export type LazyMountTrigger = (() => void) | undefined;

export type LazyMountControllerOptions = {
  /** Element to observe. */
  target: Element;
  /** Called once when the element should be mounted. */
  onMount: () => void;
  /**
   * Margin around the viewport for the observer. Defaults to "200px 0px"
   * which is the value used by the OverlayMiniPreview implementation.
   */
  rootMargin?: string;
  /**
   * Idle-fallback base delay in ms. After this delay the controller
   * triggers `onMount` even if the element never intersects the viewport.
   */
  baseDelay?: number;
  /**
   * Multiplier applied to `target.getBoundingClientRect().top` so far-off
   * tiles wait proportionally longer before the fallback fires. Same
   * formula as OverlayMiniPreview (`extraDelay = min(2400, max(0, top) *
   * 0.4)`). Disable by passing 0.
   */
  rectMultiplier?: number;
  /**
   * Maximum extra delay added to baseDelay when the rect multiplier
   * produces a large value. Defaults to 2400ms (matches OverlayMiniPreview).
   */
  maxExtraDelay?: number;
};

export type LazyMountController = {
  /** Stops the observer + fallback timer; idempotent. */
  destroy: () => void;
};

/**
 * Compute the proportional fallback delay for a given target element. Pure
 * helper exposed so it can be unit-tested without spinning up a JSDOM
 * IntersectionObserver.
 */
export function computeFallbackDelay(
  target: Element,
  baseDelay: number,
  rectMultiplier: number,
  maxExtraDelay: number,
): number {
  let extraDelay = 0;
  try {
    const rect = (target as Element & {
      getBoundingClientRect?: () => { top: number };
    }).getBoundingClientRect?.();
    if (rect) {
      extraDelay = Math.min(
        maxExtraDelay,
        Math.max(0, rect.top) * rectMultiplier,
      );
    }
  } catch {
    extraDelay = 0;
  }
  return baseDelay + extraDelay;
}

/**
 * Wire up the IntersectionObserver-gated lazy mount with idle fallback.
 *
 * Call once per lifecycle. Returns a controller whose `destroy()` stops
 * both the observer + the fallback timer. Calling `onMount` is idempotent —
 * it is invoked at most once per controller instance.
 */
export function createLazyMountController(
  opts: LazyMountControllerOptions,
): LazyMountController {
  let mounted = false;
  let cancelled = false;
  let io: IntersectionObserver | null = null;
  let idleHandle: ReturnType<typeof setTimeout> | null = null;

  const baseDelay = opts.baseDelay ?? 400;
  const rectMultiplier = opts.rectMultiplier ?? 0.4;
  const maxExtraDelay = opts.maxExtraDelay ?? 2400;

  const mountNow = (): void => {
    if (mounted || cancelled) return;
    mounted = true;
    try {
      opts.onMount();
    } finally {
      if (io) {
        io.disconnect();
        io = null;
      }
      if (idleHandle) {
        clearTimeout(idleHandle);
        idleHandle = null;
      }
    }
  };

  // Browsers without IntersectionObserver -> eager mount.
  if (typeof IntersectionObserver === "undefined") {
    mountNow();
    return {
      destroy: () => {
        cancelled = true;
        if (idleHandle) clearTimeout(idleHandle);
      },
    };
  }

  io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          mountNow();
          break;
        }
      }
    },
    { rootMargin: opts.rootMargin ?? "200px 0px", threshold: 0.01 },
  );
  io.observe(opts.target);

  // Fallback timer ensures off-screen / E2E specs still mount.
  const fallback = computeFallbackDelay(
    opts.target,
    baseDelay,
    rectMultiplier,
    maxExtraDelay,
  );
  idleHandle = setTimeout(mountNow, fallback);

  return {
    destroy: () => {
      cancelled = true;
      if (io) {
        io.disconnect();
        io = null;
      }
      if (idleHandle) {
        clearTimeout(idleHandle);
        idleHandle = null;
      }
    },
  };
}

/**
 * CSS rules applied to the lazy-mount stage. Returned as a record so
 * callers can spread directly onto `style={...}`.
 */
export function lazyMountStageStyle(opts: {
  tileWidth: number;
  tileHeight: number;
  compactHeader?: boolean;
}): Record<string, string> {
  return {
    contentVisibility: "auto",
    containIntrinsicSize: `${opts.tileHeight + (opts.compactHeader ? 22 : 28)}px ${opts.tileWidth}px`,
  };
}
