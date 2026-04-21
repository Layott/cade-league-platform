"use client";

import type { ReactNode } from "react";
import type { OverlayState } from "./useOverlayChannel";

/**
 * Shared visual chrome for every overlay stub page. Renders:
 *   - an optional debug HUD (connection state + last event ts) when
 *     `NEXT_PUBLIC_OVERLAY_DEBUG=1`, guarded by a `?debug=1` query.
 *   - the visible card which fades in when `payload` is non-null and
 *     out when null. 300ms CSS transition.
 *
 * Positioning is absolute to the viewport edges so the broadcast tool
 * (OBS, vMix, Streamlabs, etc.) can key/crop.
 */
export function OverlayFrame({
  state,
  debug,
  position = "bottom-left",
  children,
}: {
  state: OverlayState;
  debug: boolean;
  position?: "bottom-left" | "bottom-center" | "top-right" | "center";
  children: ReactNode;
}) {
  const visible = state.payload !== null;

  const posClass =
    position === "bottom-center"
      ? "left-1/2 bottom-8 -translate-x-1/2"
      : position === "top-right"
        ? "top-8 right-8"
        : position === "center"
          ? "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
          : "bottom-8 left-8";

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
          }}
        >
          {state.connected ? "conn" : "off"} ·{" "}
          {state.eventId ? state.eventId.slice(0, 8) : "—"} ·{" "}
          {state.lastEventAt
            ? new Date(state.lastEventAt).toLocaleTimeString()
            : "—"}
        </div>
      ) : null}
      <div
        className={`absolute ${posClass}`}
        style={{
          opacity: visible ? 1 : 0,
          transform: `${
            position === "bottom-center"
              ? "translateX(-50%)"
              : position === "center"
                ? "translate(-50%, -50%)"
                : ""
          } translateY(${visible ? "0" : "8px"})`,
          transition: "opacity 300ms ease, transform 300ms ease",
          pointerEvents: visible ? "auto" : "none",
        }}
        data-testid="overlay-card"
      >
        {visible ? children : null}
      </div>
    </div>
  );
}

export function getDebugFlag(): boolean {
  if (typeof window === "undefined") return false;
  if (process.env.NEXT_PUBLIC_OVERLAY_DEBUG !== "1") return false;
  const sp = new URLSearchParams(window.location.search);
  return sp.get("debug") === "1";
}
