"use client";

import type { ReactElement } from "react";
import { useEffect, useRef } from "react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { v2ToLegacy } from "./template-mapping";
import type { V2OverlayKey } from "./overlay-keys";

/**
 * Plan 51 — v2 overlay data injector.
 *
 * Companion to the static HTML mirrored under `/public/overlays/v2/<key>/
 * index.html` by `apps/web/scripts/sync-v2-overlays.mjs`. The HTML is
 * source-of-truth (designers iterate by editing the HTML); this component
 * is the thin Next.js shim that:
 *
 *  1. Renders an `<iframe>` pointed at the static HTML mirror.
 *  2. Subscribes to the `public:standings:<seasonId>` Realtime channel and
 *     forwards relevant events as `{ type: 'update', event, payload }`
 *     postMessages into the iframe.
 *  3. Acts as a relay: any postMessage the parent page receives (e.g. from
 *     the broadcast control panel preview iframes) is forwarded into the
 *     iframe so editorial pickers (h2h players, lower-third slots, timer
 *     duration) drive the live design without rebuilding.
 *
 * The HTML's existing `window.addEventListener('message', ...)` handler is
 * the contract — see e.g. `KNOWLEDGE/brand-assets/elements/v2/02-timer/
 * index.html` and `08-lower-third/index.html`. Designer never has to touch
 * `.tsx` to update the visuals.
 *
 * Per-key Realtime wiring (only overlays that consume live DB state need
 * subscriptions — most v2 overlays are control-panel-driven via the
 * postMessage relay):
 *
 *   07-leaderboard         → standings.changed
 *   09-secondary-score-bug → score.changed
 *   10-up-next-bug         → match.ended (for "next fixture" recompute)
 *   11-match-scores-day    → score.changed + match.ended + standings.changed
 *   14-top-scorers         → match.ended (recompute scorer ladder)
 *   17-penalties           → standings.changed (proxy for disciplinary edits;
 *                            DB recompute fires this on penalty insert)
 *
 * All others receive only relayed postMessages from the broadcast control
 * panel (BRB / starting-soon / stream-ended / timer / lower-third /
 * h2h-N / orgs / coaches).
 */

type KeyEvent =
  | "standings.changed"
  | "score.changed"
  | "match.ended"
  | "walkover.confirmed"
  | "snapshot.captured";

const REALTIME_KEY_EVENTS: Readonly<Record<string, ReadonlyArray<KeyEvent>>> = {
  "07-leaderboard": ["standings.changed", "snapshot.captured"],
  "09-secondary-score-bug": ["score.changed"],
  "10-up-next-bug": ["match.ended"],
  "11-match-scores-day": [
    "score.changed",
    "match.ended",
    "standings.changed",
  ],
  "14-top-scorers": ["match.ended", "standings.changed"],
  "17-penalties": ["standings.changed"],
};

export type OverlayDataInjectorProps = {
  overlayKey: string;
  sessionId?: string;
  token?: string;
  /**
   * Optional season scope for Realtime subscriptions. When omitted the
   * component renders the iframe but does not open a channel — useful for
   * legacy `/overlay/v2/<key>` smoke tests without a live session.
   */
  seasonId?: string;
};

export default function OverlayDataInjector({
  overlayKey,
  sessionId,
  token,
  seasonId,
}: OverlayDataInjectorProps): ReactElement {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  /* --------------------------------------------------------------- *
   * 1a. Trigger channel — overlay:<sessionId>                        *
   *                                                                 *
   * ENTER on the broadcast control panel writes an overlay_events    *
   * row + publishes `overlay.triggered` on `overlay:<sessionId>`.    *
   * OUT publishes `overlay.cleared`. Multi-instance overlays         *
   * (lower_third) use `instance.triggered` / `instance.cleared`.     *
   *                                                                 *
   * Forward each as a postMessage the static HTML can consume:       *
   *   triggered → { type: 'show', data: payload }                    *
   *   cleared   → { type: 'hide' }                                   *
   *   updated   → { type: 'update', data: payload }                  *
   * The static HTML's existing handler shape is honoured so          *
   * designers can keep editing CSS/HTML without touching .tsx.       *
   * --------------------------------------------------------------- */
  useEffect(() => {
    if (!sessionId) return;
    const sb = getBrowserSupabase();
    const channel = sb.channel(`overlay:${sessionId}`, {
      config: { broadcast: { self: true } },
    });

    let legacyKey: string | null = null;
    try {
      legacyKey = v2ToLegacy(overlayKey as V2OverlayKey);
    } catch {
      legacyKey = null;
    }

    function postToInner(msg: Record<string, unknown>): void {
      const iframe = iframeRef.current;
      if (!iframe || !iframe.contentWindow) return;
      try {
        iframe.contentWindow.postMessage(msg, "*");
      } catch {
        /* swallow cross-origin/closed-window */
      }
    }

    function isForThisOverlay(payload: unknown): boolean {
      if (!payload || typeof payload !== "object") return false;
      const p = payload as Record<string, unknown>;
      // Match by templateKey (legacy) or overlayKey (v2) — defensive.
      if (legacyKey && p.templateKey === legacyKey) return true;
      if (p.overlayKey === overlayKey) return true;
      return false;
    }

    channel.on("broadcast", { event: "overlay.triggered" }, (msg) => {
      if (!isForThisOverlay(msg.payload)) return;
      const payload = (msg.payload as { payload?: Record<string, unknown> })
        ?.payload;
      postToInner({ type: "show", data: payload ?? null });
      postToInner({ type: "update", data: payload ?? null });
    });

    channel.on("broadcast", { event: "overlay.cleared" }, (msg) => {
      if (!isForThisOverlay(msg.payload)) return;
      postToInner({ type: "hide" });
    });

    channel.on("broadcast", { event: "instance.triggered" }, (msg) => {
      if (!isForThisOverlay(msg.payload)) return;
      const m = msg.payload as {
        payload?: Record<string, unknown>;
        instanceSlot?: number;
      };
      postToInner({
        type: "show",
        slot: m.instanceSlot ?? null,
        data: m.payload ?? null,
      });
      postToInner({
        type: "update",
        slot: m.instanceSlot ?? null,
        data: m.payload ?? null,
      });
    });

    channel.on("broadcast", { event: "instance.cleared" }, (msg) => {
      if (!isForThisOverlay(msg.payload)) return;
      const m = msg.payload as { instanceSlot?: number };
      postToInner({ type: "hide", slot: m.instanceSlot ?? null });
    });

    channel.subscribe();

    return () => {
      try {
        sb.removeChannel(channel);
      } catch {
        /* best-effort */
      }
    };
  }, [overlayKey, sessionId]);

  /* --------------------------------------------------------------- *
   * 1b. Data feed — public:standings:<seasonId> (existing behaviour) *
   * --------------------------------------------------------------- */
  useEffect(() => {
    if (!seasonId) return;
    const events = REALTIME_KEY_EVENTS[overlayKey];
    if (!events || events.length === 0) return;

    const sb = getBrowserSupabase();
    const channel = sb.channel(`public:standings:${seasonId}`, {
      config: { broadcast: { self: false } },
    });

    for (const event of events) {
      channel.on("broadcast", { event }, (msg) => {
        const iframe = iframeRef.current;
        if (!iframe || !iframe.contentWindow) return;
        iframe.contentWindow.postMessage(
          { type: "update", event, payload: msg.payload ?? null },
          "*",
        );
      });
    }

    channel.subscribe();

    return () => {
      try {
        sb.removeChannel(channel);
      } catch {
        // best-effort cleanup
      }
    };
  }, [overlayKey, seasonId]);

  /* --------------------------------------------------------------- *
   * 2. Parent postMessage relay (control panel → overlay iframe)    *
   * --------------------------------------------------------------- */
  useEffect(() => {
    function relay(e: MessageEvent): void {
      const iframe = iframeRef.current;
      if (!iframe || !iframe.contentWindow) return;
      // Don't echo messages back into the iframe that originated from it.
      if (e.source === iframe.contentWindow) return;
      // Only forward plain-object messages — ignores random extension noise.
      if (typeof e.data !== "object" || e.data === null) return;
      iframe.contentWindow.postMessage(e.data, "*");
    }
    window.addEventListener("message", relay);
    return () => window.removeEventListener("message", relay);
  }, []);

  // Pass session + token in the iframe URL so HTML-side handlers that opt
  // into auth can grab them via `URLSearchParams`. They're optional.
  const params = new URLSearchParams();
  if (sessionId) params.set("session", sessionId);
  if (token) params.set("token", token);
  const qs = params.toString();
  const src = `/overlays/v2/${overlayKey}/index.html${qs ? `?${qs}` : ""}`;

  return (
    <iframe
      ref={iframeRef}
      src={src}
      title={`Overlay v2 · ${overlayKey}`}
      allow="autoplay"
      style={{
        border: 0,
        width: "100vw",
        height: "100vh",
        background: "transparent",
        display: "block",
      }}
    />
  );
}
