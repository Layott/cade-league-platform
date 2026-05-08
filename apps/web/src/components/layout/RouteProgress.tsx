"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * 2026-05-08 — global top-bar route-progress indicator.
 *
 * Mounted once in the root layout. Watches for `usePathname` + `useSearchParams`
 * transitions and animates a 2px brand-green bar across the viewport while
 * the next segment is suspending. When combined with per-segment
 * `loading.tsx` skeletons it gives the player + admin surfaces a NProgress-
 * style "something is happening" cue that costs no per-page wiring.
 *
 * Strategy:
 *   1. On every pathname/search change → reset to 0, ramp to ~90% over
 *      ~500ms, hold (because we can't observe Server Component stream
 *      completion from the client without router events).
 *   2. Next change → snap to 100% + fade out, then start the next ramp.
 *   3. First mount sees no transition; bar stays hidden.
 *
 * The bar is brand green (`#6bcd06`) with a soft pink (`#fe036d`) highlight
 * trailing the head, so it reads as part of the CADE palette rather than a
 * generic loader.
 */

const FULL_HOLD = 92; // %
const RAMP_MS = 500;

export function RouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const firstMount = useRef(true);
  const rampTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (firstMount.current) {
      firstMount.current = false;
      return;
    }

    if (rampTimer.current) clearTimeout(rampTimer.current);
    if (completeTimer.current) clearTimeout(completeTimer.current);

    setVisible(true);
    setProgress(8);
    rampTimer.current = setTimeout(() => setProgress(FULL_HOLD), 30);

    completeTimer.current = setTimeout(() => {
      setProgress(100);
      setTimeout(() => {
        setVisible(false);
        setTimeout(() => setProgress(0), 220);
      }, 180);
    }, RAMP_MS + 220);

    return () => {
      if (rampTimer.current) clearTimeout(rampTimer.current);
      if (completeTimer.current) clearTimeout(completeTimer.current);
    };
  }, [pathname, searchParams]);

  return (
    <div
      aria-hidden
      data-testid="route-progress"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        zIndex: 9999,
        pointerEvents: "none",
        opacity: visible ? 1 : 0,
        transition: visible ? "opacity 80ms linear" : "opacity 220ms ease-out",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${progress}%`,
          background:
            "linear-gradient(90deg, #6bcd06 0%, #6bcd06 80%, #fe036d 100%)",
          boxShadow:
            "0 0 8px rgba(107,205,6,0.65), 0 0 14px rgba(254,3,109,0.45)",
          transition: `width ${RAMP_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
        }}
      />
    </div>
  );
}
