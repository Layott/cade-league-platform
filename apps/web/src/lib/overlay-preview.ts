"use client";

/**
 * Plan 16 — `usePreviewMode` + related preview-harness helpers.
 *
 * Every production `/overlay/<key>` page wires this hook so adding
 * `?preview=1` to the URL switches it into a demo loop:
 *   - Payload is read from the `payload` query param (base64 JSON) or
 *     an `overlay-preview:<key>` `localStorage` entry.
 *   - A cycle counter increments every 8s. Consumers re-mount motion
 *     via `key={cycle}` on their animated root so enter/idle/exit
 *     re-runs without the operator clicking anything.
 *   - When `NEXT_PUBLIC_OVERLAY_DEBUG=1`, a bottom-right HUD is rendered
 *     reading `template=<key> ver=<n> sound=<slot|null>`.
 */

import { useEffect, useState, useCallback } from "react";

export type PreviewModeState = {
  enabled: boolean;
  cycle: number;
  payload: unknown;
  version: number;
};

function decodePayloadParam(raw: string | null): unknown {
  if (!raw) return null;
  try {
    // Accept base64url-encoded JSON or raw JSON (decodeURIComponent handles the URL-safe piece).
    let str = raw.trim();
    if (!str.startsWith("{") && !str.startsWith("[")) {
      try {
        str = atob(str.replaceAll("-", "+").replaceAll("_", "/"));
      } catch {
        /* fall through — treat as already-JSON */
      }
    }
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function readPreviewParams(): { enabled: boolean; payload: unknown; version: number } {
  if (typeof window === "undefined") {
    return { enabled: false, payload: null, version: 1 };
  }
  const sp = new URLSearchParams(window.location.search);
  const enabled = sp.get("preview") === "1";
  const payload = decodePayloadParam(sp.get("payload"));
  const version = Number(sp.get("ver") ?? "1");
  return { enabled, payload, version: Number.isFinite(version) ? version : 1 };
}

export function usePreviewMode(opts?: {
  /** Cycle interval in ms. Defaults to 8_000. */
  cycleMs?: number;
}): PreviewModeState {
  const cycleMs = opts?.cycleMs ?? 8_000;
  const [state, setState] = useState<PreviewModeState>(() => {
    const params = readPreviewParams();
    return { enabled: params.enabled, cycle: 0, payload: params.payload, version: params.version };
  });

  useEffect(() => {
    if (!state.enabled) return;
    const id = window.setInterval(() => {
      setState((s) => ({ ...s, cycle: s.cycle + 1 }));
    }, cycleMs);
    return () => window.clearInterval(id);
  }, [state.enabled, cycleMs]);

  return state;
}

/** Event protocol for `/overlay/design-preview` iframe postMessage. */
export type PreviewMessage =
  | { type: "overlay-preview.animate-in" }
  | { type: "overlay-preview.exit" }
  | { type: "overlay-preview.loop"; on: boolean }
  | { type: "overlay-preview.sound"; on: boolean }
  | { type: "overlay-preview.speed"; value: number }
  | { type: "overlay-preview.payload"; payload: unknown };

export function sendPreviewMessage(frame: HTMLIFrameElement | null, msg: PreviewMessage) {
  if (!frame?.contentWindow) return;
  frame.contentWindow.postMessage(msg, "*");
}

export function useListenForPreviewMessages(
  handler: (msg: PreviewMessage) => void,
) {
  const wrapped = useCallback(
    (ev: MessageEvent) => {
      if (!ev.data || typeof ev.data !== "object") return;
      const { type } = ev.data as { type?: string };
      if (typeof type !== "string" || !type.startsWith("overlay-preview.")) return;
      handler(ev.data as PreviewMessage);
    },
    [handler],
  );
  useEffect(() => {
    window.addEventListener("message", wrapped);
    return () => window.removeEventListener("message", wrapped);
  }, [wrapped]);
}

/** Safe base64-url JSON encode for a preview payload query-param. */
export function encodePayloadForPreview(obj: unknown): string {
  try {
    const json = JSON.stringify(obj);
    if (typeof window === "undefined") return encodeURIComponent(json);
    const b64 = btoa(unescape(encodeURIComponent(json)));
    return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  } catch {
    return "";
  }
}
