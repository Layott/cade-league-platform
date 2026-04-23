"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ENTER, EXIT } from "@/lib/motion";
import type { OverlayState } from "./useOverlayChannel";

/**
 * Shared visual chrome for every overlay stub page.
 *
 * Renders:
 *   - optional debug HUD (connection state + last event) when
 *     `NEXT_PUBLIC_OVERLAY_DEBUG=1` AND `?debug=1` is in the URL.
 *   - the visible card, animated in/out via framer-motion AnimatePresence
 *     using motion tokens from `@/lib/motion`.
 *
 * `position` variants:
 *   - `fullscreen` — children fill 100vw × 100vh; no positional wrapper,
 *     no translate. For stingers, starting-soon, stream-ended.
 *   - `bottom-left` | `bottom-center` | `top-right` | `center` — classic
 *     positional placements for small widgets.
 *
 * A new `motionKey` prop re-mounts the card (re-running enter/exit) when
 * it changes. Design-preview uses this with the cycle counter so each
 * 8-second loop restages the animation.
 */
export type OverlayPosition =
  | "bottom-left"
  | "bottom-center"
  | "top-right"
  | "center"
  | "fullscreen";

export function OverlayFrame({
  state,
  debug,
  position = "bottom-left",
  motionKey,
  children,
}: {
  state: OverlayState;
  debug: boolean;
  position?: OverlayPosition;
  motionKey?: string | number;
  children: ReactNode;
}) {
  const visible = state.payload !== null;
  const key = motionKey ?? state.eventId ?? "overlay";

  const isFullscreen = position === "fullscreen";

  const posStyle: React.CSSProperties = isFullscreen
    ? { position: "fixed", inset: 0 }
    : position === "bottom-center"
      ? { position: "fixed", left: "50%", bottom: 32, transform: "translateX(-50%)" }
      : position === "top-right"
        ? { position: "fixed", top: 32, right: 32 }
        : position === "center"
          ? {
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
            }
          : { position: "fixed", left: 32, bottom: 32 };

  // Plan 48.2 — exit reverses entry: opposite direction, same duration +
  // easing. Non-fullscreen entry starts y: 8 (below), exit slides up to
  // y: -8 (above). Fullscreen entry starts slightly larger (1.04), exit
  // drops below unity (0.96) — still a mirror across the animate target.
  const enterFrom = isFullscreen
    ? { opacity: 0, scale: 1.04 }
    : { opacity: 0, y: 8, scale: 0.98 };
  const enterTo = { opacity: 1, y: 0, scale: 1 };
  const exitTo = isFullscreen
    ? { opacity: 0, scale: 0.96 }
    : { opacity: 0, y: -8, scale: 1.02 };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        background: "transparent",
      }}
      data-testid="overlay-root"
    >
      {debug ? (
        <div
          data-testid="overlay-debug"
          className="font-mono"
          style={{
            position: "fixed",
            top: 8,
            left: 8,
            padding: "4px 8px",
            background: "rgba(0,0,0,0.6)",
            color: "var(--primary)",
            fontSize: 11,
            border: "1px solid rgba(107,205,6,0.4)",
            zIndex: 9999,
            pointerEvents: "none",
          }}
        >
          {state.connected ? "conn" : "off"} ·{" "}
          {state.eventId ? state.eventId.slice(0, 12) : "—"} ·{" "}
          {state.lastEventAt
            ? new Date(state.lastEventAt).toLocaleTimeString()
            : "—"}
        </div>
      ) : null}
      <AnimatePresence mode="wait">
        {visible ? (
          <motion.div
            key={String(key)}
            initial={enterFrom}
            animate={enterTo}
            exit={exitTo}
            transition={{ ...ENTER }}
            style={{
              ...posStyle,
              pointerEvents: "auto",
              ...(isFullscreen
                ? { width: "100vw", height: "100vh" }
                : {}),
            }}
            data-testid="overlay-card"
          >
            {children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function getDebugFlag(): boolean {
  if (typeof window === "undefined") return false;
  if (process.env.NEXT_PUBLIC_OVERLAY_DEBUG !== "1") return false;
  const sp = new URLSearchParams(window.location.search);
  return sp.get("debug") === "1";
}

// Re-export motion so template pages can use it without a separate import.
export { motion, AnimatePresence } from "framer-motion";
// Token re-exports — keeps per-template files from hand-rolling imports.
export { ENTER, EXIT };
