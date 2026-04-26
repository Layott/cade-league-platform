"use client";

import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { REALTIME } from "@/server/overlays/registry";
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
 *  4. Initial-state seed: on iframe `load`, if the overlayKey has a
 *     matching `/api/broadcast/...` endpoint, fetches the current payload
 *     and posts it into the iframe so the design renders the live data
 *     before any Realtime event lands.
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
 *   07-leaderboard         → standings.changed + snapshot.captured
 *   09-secondary-score-bug → score.changed
 *   10-up-next-bug         → match.ended (for "next fixture" recompute)
 *   11-match-scores-day    → score.changed + match.ended + standings.changed
 *   14-top-scorers         → match.ended + standings.changed
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

/**
 * Plan 51 §6 — initial-state fetch on mount.
 *
 * For data-driven overlays we hit the matching `/api/broadcast/...` endpoint
 * (or `/api/broadcast/v2/...` for v2-only stubs) to seed the iframe with the
 * current payload before any Realtime event lands. Skipped when no
 * `sessionId` is supplied (standalone OBS smoke previews render empty).
 */
const INITIAL_FETCH_PATH: Readonly<Record<string, (sessionId: string) => string>> = {
  "07-leaderboard": (s) => `/api/broadcast/sessions/${s}/leaderboard`,
  "11-match-scores-day": (s) => `/api/broadcast/sessions/${s}/match-scores-day`,
  "14-top-scorers": (s) => `/api/broadcast/sessions/${s}/top-scorers`,
  // v2-only stubs — orgs/coaches/penalties have no legacy counterpart.
  "15-orgs": (s) => `/api/broadcast/v2/sessions/${s}/orgs`,
  "16-coaches": (s) => `/api/broadcast/v2/sessions/${s}/coaches`,
  "17-penalties": (s) => `/api/broadcast/v2/sessions/${s}/penalties`,
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
  /**
   * Whether the overlay is currently triggered on stream (server has a
   * row in `overlay_events` / `overlay_active_instances`). Defaults to
   * `true` so legacy / OBS / smoke callers preserve the existing
   * fetch-on-mount behaviour. The broadcast control room mini-preview
   * passes `false` when no row exists so the iframe stays idle (overlay
   * HTML's default-OFF) — without this gate, the always-fired initial
   * fetch + update postMessage caused data-driven overlays
   * (orgs / coaches / penalties) to look "live" in the preview even
   * when they were OFF on stream.
   *
   * Realtime channel subscriptions remain on regardless so any server
   * state change mid-session repaints the iframe.
   */
  active?: boolean;
};

export default function OverlayDataInjector({
  overlayKey,
  sessionId,
  token,
  seasonId,
  active = true,
}: OverlayDataInjectorProps): ReactElement {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  /* --------------------------------------------------------------- *
   * 0. Initial-state fetch — seed iframe with current data on mount  *
   *                                                                 *
   * Only fires when ALL of:                                          *
   *   - `sessionId` is supplied                                      *
   *   - the overlay key is in `INITIAL_FETCH_PATH`                   *
   *   - `active` is true (server has the row in overlay_events /     *
   *     overlay_active_instances)                                    *
   *                                                                 *
   * Standalone OBS smoke previews (no session) render empty until a  *
   * control-panel postMessage arrives. When `active=false` the       *
   * iframe still mounts but the initial fetch is skipped so the      *
   * overlay HTML stays in default-OFF (no `cade-visible` class) —    *
   * Realtime events will fire `show` if the server flips it on later.*
   * The payload is forwarded as a `{type:'update'}` postMessage      *
   * matching the Realtime event shape.                               *
   * --------------------------------------------------------------- */
  useEffect(() => {
    if (!sessionId) return;
    if (!active) return;
    const builder = INITIAL_FETCH_PATH[overlayKey];
    if (!builder) return;
    if (!iframeLoaded) return;

    let cancelled = false;
    const url = builder(sessionId);
    const fetchUrl = token
      ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
      : url;

    fetch(fetchUrl, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const iframe = iframeRef.current;
        if (!iframe || !iframe.contentWindow) return;
        // Send the entire response as the initial payload — overlay HTML
        // can pick `payload`, `rows`, etc. via its own message handler.
        iframe.contentWindow.postMessage(
          { type: "update", event: "initial.fetch", payload: data },
          "*",
        );
      })
      .catch(() => {
        // best-effort — Realtime events will refresh once data lands
      });

    return () => {
      cancelled = true;
    };
  }, [overlayKey, sessionId, token, iframeLoaded, active]);

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
    const channel = sb.channel(REALTIME.channel(sessionId), {
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
    const channel = sb.channel(REALTIME.standingsChannel(seasonId), {
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
      onLoad={() => setIframeLoaded(true)}
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
