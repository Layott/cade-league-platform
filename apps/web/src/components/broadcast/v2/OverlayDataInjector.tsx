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
  // Phase B4-B5 + C — H2H overlays subscribe to standings.changed so the
  // stat-row cells (Pos / P / W / D / L / GF / GA / GD / Pts / WinProb%)
  // auto-update mid-stream when match results post. CLAUDE.md §14 hard
  // rule: any auto-update overlay MUST be wired here.
  "04-h2h-2": ["standings.changed"],
  "05-h2h-3": ["standings.changed"],
  "06-h2h-5": ["standings.changed"],
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
  // 19-player-squads — repaint when standings recompute (proxy for
  // disciplinary edits affecting the displayed player) and when a new
  // match-day boundary lands. Squad-submission edits don't hit the
  // overlay mid-stream — submissions land outside live-broadcast windows.
  "19-player-squads": ["standings.changed", "match.ended"],
  // 20-highlight — same as match-scores-day; bottom strip shows recent
  // fixtures so we resubscribe to score + match-end events.
  "20-highlight": ["score.changed", "match.ended", "standings.changed"],
};

/**
 * Plan 51 §6 — initial-state fetch on mount.
 *
 * For data-driven overlays we hit the matching `/api/broadcast/...` endpoint
 * (or `/api/broadcast/v2/...` for v2-only stubs) to seed the iframe with the
 * current payload before any Realtime event lands. Skipped when no
 * `sessionId` is supplied (standalone OBS smoke previews render empty).
 */
const INITIAL_FETCH_PATH: Readonly<Record<string, (sessionId: string, overlayKey: string) => string>> = {
  // Phase B4-B5 + C — H2H endpoint resolves the pinned players from the
  // latest overlay_events row (broadcast control panel writes them on
  // Trigger). The endpoint walks displayName → users.gamer_tag →
  // players.id and returns the same H2HCard shape as
  // `/api/tournament/h2h`. We pass `?key=<overlayKey>` so the route can
  // pick the right template_key (`h2h_2` / `h2h_3` / `h2h_5`).
  "04-h2h-2": (s, k) =>
    `/api/broadcast/sessions/${s}/h2h?key=${encodeURIComponent(k)}`,
  "05-h2h-3": (s, k) =>
    `/api/broadcast/sessions/${s}/h2h?key=${encodeURIComponent(k)}`,
  "06-h2h-5": (s, k) =>
    `/api/broadcast/sessions/${s}/h2h?key=${encodeURIComponent(k)}`,
  "07-leaderboard": (s) => `/api/broadcast/sessions/${s}/leaderboard`,
  "11-match-scores-day": (s) => `/api/broadcast/sessions/${s}/match-scores-day`,
  "14-top-scorers": (s) => `/api/broadcast/sessions/${s}/top-scorers`,
  // v2-only stubs — orgs/coaches/penalties have no legacy counterpart.
  "15-orgs": (s) => `/api/broadcast/v2/sessions/${s}/orgs`,
  "16-coaches": (s) => `/api/broadcast/v2/sessions/${s}/coaches`,
  "17-penalties": (s) => `/api/broadcast/v2/sessions/${s}/penalties`,
  "19-player-squads": (s) => `/api/broadcast/v2/sessions/${s}/player-squads`,
  // 20-highlight reuses the existing match-scores-day endpoint — same
  // shape (week + fixtures), different overlay layout.
  "20-highlight": (s) => `/api/broadcast/sessions/${s}/match-scores-day`,
};

/**
 * Ambient-session poll interval — see "ambient mode" jsdoc on
 * OverlayDataInjector. 30s matches the spec; tunable if event ops want
 * snappier failover, but each poll is a single fetch with no DB read on
 * a steady-state hit (Supabase covers the index lookup). Exported so
 * tests can stub a faster cadence without faking timers.
 */
export const AMBIENT_POLL_MS = 30_000;

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
  /**
   * 2026-04-26 lower-third slot isolation — when set (1..3), the
   * injector:
   *   1. appends `?slot=N` to the static HTML iframe URL so the HTML
   *      hides the other 2 slot anchors + filters its own postMessages.
   *   2. drops realtime / parent-relay messages whose `slot` field is
   *      set AND does not match (so card 1's mini-preview never sees
   *      slot 2's `instance.triggered` event).
   * Live (OBS) routes leave this null so all 3 anchors render.
   */
  slot?: 1 | 2 | 3 | null;
  /**
   * Ambient-session mode (2026-04-26).
   *
   * When true, the injector polls `/api/broadcast/active-session` every
   * `AMBIENT_POLL_MS` and updates its internal session id when the
   * active broadcast session flips (one ends + a new one starts mid-
   * stream). Used by live OBS / vMix browser sources pointed at the
   * stable `https://cade-league.vercel.app/overlay/v2/<key>` URL with
   * NO `?session=` param — the page-level resolver picks up the current
   * session at SSR time + this flag keeps it fresh thereafter.
   *
   * Mini-preview iframes inside the broadcast control room MUST leave
   * this off — they should stay pinned to the session the operator
   * picked. Default is false to preserve test-suite behaviour for
   * callers that pass an explicit `sessionId`.
   */
  ambient?: boolean;
  /**
   * 2026-04-28 — Bug #25 fix.
   *
   * When the SSR wrapper route at `/overlay/v2/<key>` is invoked with
   * `?demo=1` (or `?demo=true` / `?demo=yes`), the page-level resolver
   * passes `demo=true` here and the injector appends `demo=1` onto the
   * iframe `src`. The static HTML's `data-tag="cade-demo-mode"` block
   * is gated on `?demo=1` per CLAUDE.md §14, so without this hop the
   * demo cycle never fires when navigating the SSR wrapper directly
   * (the OBS-source flow + admin design editor preview both depend on
   * this).
   *
   * Live (non-demo) OBS / vMix URLs leave this false so the demo loop
   * never fires on stream.
   */
  demo?: boolean;
  /**
   * Phase A — overlay design tokens.
   *
   * Persisted DB tokens for this overlay+variant, resolved server-side
   * via `resolveTokens` and injected into the iframe URL as
   * `?tokens=<base64-json>`. The static HTML's inline bootstrap script
   * decodes the param into a `<style id="cade-injected-tokens">` block
   * appended to `<head>` — landing AFTER the HTML's hard-coded
   * `:root{...}` defaults so its values win the CSS source-order cascade.
   *
   * This is the cross-document propagation fix (the SSR `<style>` blocks
   * the page injects sit on the OUTER document; CSS variables don't
   * cross the iframe boundary so the persisted tokens never reached the
   * actual rendered overlay HTML before this).
   */
  designTokens?: Record<string, string>;
  /**
   * Phase A — admin live-preview overrides. Same wire as `designTokens`
   * but encoded into `?previewTokens=<base64-json>`. Both blocks are
   * appended to `<head>` in order: design first, preview second, so
   * preview overrides design via source-order. Pass undefined when the
   * caller is not the admin design editor (live OBS, mini-previews) so
   * the iframe URL stays clean.
   */
  previewTokens?: Record<string, string>;
  /**
   * Wave 2 Stage 2 — text-element overrides resolved server-side from
   * `overlay_text_elements`. Each entry is a per-element shape:
   *   {
   *     origin: 'seed'|'runtime',
   *     visible: boolean,
   *     content: string|null,    // null = use HTML default
   *     styles: { color?, fontFamily?, fontSize?, fontWeight?, ... }
   *   }
   * Encoded as base64-JSON onto the iframe URL as `?textTokens=<b64>`.
   * The bootstrap script in each overlay HTML decodes the param +
   * applies inline `style` attributes / textContent edits to elements
   * with matching `data-element-id`.
   */
  designTextTokens?: Record<
    string,
    {
      origin: "seed" | "runtime";
      visible: boolean;
      content: string | null;
      styles: Record<string, string | number>;
    }
  >;
  /**
   * Wave 2 Stage 2 — admin live-preview text-element overrides. Same
   * wire as `designTextTokens` but encoded as `?previewTextTokens=`.
   * Bootstrap applies preview AFTER design so preview wins source-order.
   */
  previewTextTokens?: Record<
    string,
    {
      origin?: "seed" | "runtime";
      visible?: boolean;
      content?: string | null;
      styles?: Record<string, string | number>;
    }
  >;
  /**
   * Wave 2 Stage 3 — partner-strip layout + logo roster resolved
   * server-side from `overlay_partner_strip_layout` +
   * `overlay_partner_logos` + `overlay_partner_logo_overrides`. Encoded
   * onto the iframe URL as `?partnerTokens=<b64>`. The bootstrap
   * decodes the param, rebuilds `<img>` children of the
   * `[data-element-id="partners-strip"]` container, and applies the
   * layout's anchor / position / scale / orientation / spacing as
   * inline CSS.
   *
   * Empty / undefined map → bootstrap leaves the overlay's hard-coded
   * default partner imagery in place (backward-compat invariant #1).
   */
  designPartnerTokens?: {
    layout?: {
      visible: boolean;
      positionXPx: number;
      positionYPx: number;
      anchor: string;
      orientation: string;
      scalePct: number;
      itemSpacingPx: number;
      justification: string;
      zIndex: number;
    };
    logos?: ReadonlyArray<{
      partnerKey: string;
      label: string;
      alt: string;
      fileUrl: string;
      visible?: boolean;
      sort?: number;
    }>;
  };
  /**
   * Wave 2 Stage 3 — admin live-preview partner overrides. Same wire as
   * `designPartnerTokens` but encoded as `?previewPartnerTokens=`. The
   * bootstrap re-runs the partner-rebuild handler so preview wins by
   * being applied second.
   */
  previewPartnerTokens?: {
    layout?: {
      visible: boolean;
      positionXPx: number;
      positionYPx: number;
      anchor: string;
      orientation: string;
      scalePct: number;
      itemSpacingPx: number;
      justification: string;
      zIndex: number;
    };
    logos?: ReadonlyArray<{
      partnerKey: string;
      label: string;
      alt: string;
      fileUrl: string;
      visible?: boolean;
      sort?: number;
    }>;
  };
  /**
   * Wave 2 Stage 4 — element-animation overrides resolved server-side
   * from `overlay_element_animations`. Shape:
   *   {
   *     '<elementId>': {
   *       entry?:      { animType, durationMs, delayMs, easing, iterationCount, customCssKeyframes? },
   *       exit?:       { ... },
   *       continuous?: { ... }
   *     }
   *   }
   * Encoded as base64-JSON onto the iframe URL as `?animTokens=<b64>`.
   * The bootstrap script reads the param, generates `@keyframes` blocks
   * (preset map for slide/fade/etc, sanitized custom-css for type =
   * `custom-css`), and applies the rule with phase-aware selectors:
   *   entry/continuous → `body.cade-visible [data-element-id="X"]`
   *   exit             → `body.cade-exiting [data-element-id="X"]`
   *
   * Empty / undefined map → bootstrap emits no animation rules
   * (backward-compat invariant #1).
   */
  designAnimTokens?: Record<
    string,
    Partial<
      Record<
        "entry" | "exit" | "continuous",
        {
          enabled?: boolean;
          animType: string;
          durationMs: number;
          delayMs: number;
          easing: string;
          iterationCount: string;
          customCssKeyframes?: string | null;
        }
      >
    >
  >;
  /**
   * Wave 2 Stage 4 — admin live-preview animation overrides. Same wire
   * as `designAnimTokens` but encoded as `?previewAnimTokens=`. Bootstrap
   * applies preview AFTER design so preview wins source-order on
   * identical selectors (later <style> block wins).
   */
  previewAnimTokens?: Record<
    string,
    Partial<
      Record<
        "entry" | "exit" | "continuous",
        {
          enabled?: boolean;
          animType: string;
          durationMs: number;
          delayMs: number;
          easing: string;
          iterationCount: string;
          customCssKeyframes?: string | null;
        }
      >
    >
  >;
};

/**
 * Unicode-safe base64 encoder for the design-token query param.
 *
 * `btoa` only handles latin1; brand strings can contain UTF-8
 * (e.g. an apostrophe in a future overlay label, or an em-dash in a
 * description). The `unescape(encodeURIComponent(...))` dance widens
 * to UTF-8 before `btoa` reads it. We intentionally do NOT URL-safe
 * encode (`+/=` swap) — the iframe-side decoder uses the standard
 * alphabet via `atob` to keep the inline `<script>` minimal.
 */
function encodeTokensParam(tokens: Record<string, string>): string {
  if (!tokens || Object.keys(tokens).length === 0) return "";
  try {
    const json = JSON.stringify(tokens);
    if (typeof btoa === "function") {
      // `unescape` is deprecated in favour of `decodeURIComponent`, but
      // it's still the standard pattern for the latin1-widening trick
      // that lets `btoa` handle UTF-8 strings without throwing
      // `InvalidCharacterError` on multibyte characters.
      return btoa(unescape(encodeURIComponent(json)));
    }
    // SSR / Node fallback (component is "use client" but this branch
    // exists for unit-test friendliness).
    return Buffer.from(json, "utf-8").toString("base64");
  } catch {
    return "";
  }
}

/**
 * Wave 2 Stage 2 — encode the text-tokens map into a b64-JSON URL
 * param. Identical wire to `encodeTokensParam` but typed for the
 * deeper per-element shape.
 */
function encodeTextTokensParam(
  tokens: Record<string, unknown> | undefined,
): string {
  if (!tokens || Object.keys(tokens).length === 0) return "";
  try {
    const json = JSON.stringify(tokens);
    if (typeof btoa === "function") {
      return btoa(unescape(encodeURIComponent(json)));
    }
    return Buffer.from(json, "utf-8").toString("base64");
  } catch {
    return "";
  }
}

export default function OverlayDataInjector({
  overlayKey,
  sessionId,
  token,
  seasonId,
  active = true,
  slot = null,
  ambient = false,
  demo = false,
  designTokens,
  previewTokens,
  designTextTokens,
  previewTextTokens,
  designPartnerTokens,
  previewPartnerTokens,
  designAnimTokens,
  previewAnimTokens,
}: OverlayDataInjectorProps): ReactElement {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  /* --------------------------------------------------------------- *
   * Ambient-session live state.                                      *
   *                                                                 *
   * `sessionId` is captured into state so the 30s poll below can     *
   * mutate it when the active broadcast session flips (one ends + a *
   * new one starts mid-stream). All downstream effects key off       *
   * `currentSessionId` / `currentSeasonId` so they tear down + re-   *
   * subscribe automatically when these change.                       *
   *                                                                 *
   * Live (OBS) routes typically pass `sessionId=undefined` because   *
   * the page-level resolver couldn't find one at request time. In    *
   * that case the poll latches the first sessionId it sees and keeps *
   * the channel open. Preview / explicit-session callers (mini-      *
   * preview iframes in the broadcast control room) pass an explicit  *
   * sessionId — we still poll, but only swap when the ambient ID     *
   * differs (so the operator-pinned mini-preview never accidentally  *
   * jumps to a different session).                                   *
   * --------------------------------------------------------------- */
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>(
    sessionId,
  );
  const [currentSeasonId, setCurrentSeasonId] = useState<string | undefined>(
    seasonId,
  );
  // 2026-04-26 — view_token tracked alongside session id so an ambient
  // hot-swap mid-stream picks up the new session's token automatically.
  // Without this, the initial-fetch effect would keep using the stale
  // token from the prior session and 401 against the new one.
  const [currentToken, setCurrentToken] = useState<string | undefined>(token);

  // Sync incoming prop changes (e.g. parent re-renders with a new explicit
  // session) into local state so user-driven URL changes still take effect.
  useEffect(() => {
    setCurrentSessionId(sessionId);
  }, [sessionId]);
  useEffect(() => {
    setCurrentSeasonId(seasonId);
  }, [seasonId]);
  useEffect(() => {
    setCurrentToken(token);
  }, [token]);

  // Reset iframeLoaded when the session changes — the iframe `src`
  // recomputes (it includes `?session=`), the iframe reloads, and we
  // need the initial-fetch effect to wait for the fresh `load` event
  // before posting `update` / `show`. Otherwise a race posts into a
  // half-parsed document mid-reload.
  useEffect(() => {
    setIframeLoaded(false);
  }, [currentSessionId]);

  /* --------------------------------------------------------------- *
   * Ambient-session poll — fires every AMBIENT_POLL_MS while         *
   * `ambient=true`.                                                  *
   *                                                                 *
   * Live (OBS) URLs paste once + never change. To survive a session  *
   * transition without operator action, we poll                      *
   * `/api/broadcast/active-session` and update local state when the  *
   * active session id changes. The existing channel-subscribe effect *
   * sees the new id in its dep array, tears down the old channel,    *
   * and re-subscribes to the new one.                                *
   *                                                                  *
   * Off by default — only the page-level OBS route enables ambient   *
   * mode. Mini-preview iframes in the broadcast control room stay    *
   * pinned to the operator-picked session.                           *
   *                                                                  *
   * No-ops gracefully when:                                          *
   *   - server returns null (no live session) — we keep current id   *
   *     until a new one arrives, so a brief inter-session gap does   *
   *     not blank the overlay.                                        *
   *   - response is identical to the latched value.                  *
   * --------------------------------------------------------------- */
  useEffect(() => {
    if (!ambient) return;
    let cancelled = false;
    async function pollOnce(): Promise<void> {
      try {
        const res = await fetch("/api/broadcast/active-session", {
          cache: "no-store",
        });
        if (cancelled || !res.ok) return;
        const json = (await res.json()) as {
          sessionId?: string | null;
          seasonId?: string | null;
          viewToken?: string | null;
        };
        if (cancelled) return;
        const nextSession = json.sessionId ?? null;
        const nextSeason = json.seasonId ?? null;
        const nextToken = json.viewToken ?? null;
        // Don't blank a live overlay just because the poll briefly saw
        // null — keep the latched id. New ids overwrite; explicit session
        // termination is signalled via the `session.ended` Realtime event.
        if (nextSession && nextSession !== currentSessionId) {
          setCurrentSessionId(nextSession);
        }
        if (nextSeason && nextSeason !== currentSeasonId) {
          setCurrentSeasonId(nextSeason);
        }
        if (nextToken && nextToken !== currentToken) {
          setCurrentToken(nextToken);
        }
      } catch {
        /* network blip — try again next tick */
      }
    }
    void pollOnce();
    const handle = setInterval(pollOnce, AMBIENT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [ambient, currentSessionId, currentSeasonId, currentToken]);

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
    if (!currentSessionId) return;
    if (!active) return;
    const builder = INITIAL_FETCH_PATH[overlayKey];
    if (!builder) return;
    if (!iframeLoaded) return;

    let cancelled = false;
    const url = builder(currentSessionId, overlayKey);
    // 2026-04-26 — the per-session feed endpoints accept the token via
    // `?t=<view_token>` (see `view_token_gate.ts`). Pass `currentToken`
    // (state) so an ambient hot-swap picks up the new session's token.
    const fetchUrl = currentToken
      ? `${url}${url.includes("?") ? "&" : "?"}t=${encodeURIComponent(currentToken)}`
      : url;

    fetch(fetchUrl, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const iframe = iframeRef.current;
        if (!iframe || !iframe.contentWindow) return;
        // 2026-04-26 contract refresh (CLAUDE.md §14):
        //   - `update` re-renders data WITHOUT changing visibility class.
        //   - `show` adds cade-visible (the overlay becomes visible on
        //     stream).
        //
        // The initial fetch only fires when `active=true` (server has a
        // row in overlay_events / overlay_active_instances), which means
        // the overlay IS currently triggered on stream. We therefore
        // send BOTH `update` (so the iframe renders the latest data) AND
        // `show` (so the iframe surfaces the design). Without `show`,
        // mini-previews after a page refresh would render the iframe
        // hidden even though the overlay is live on stream — operator
        // confusion.
        iframe.contentWindow.postMessage(
          { type: "update", event: "initial.fetch", payload: data, data: data },
          "*",
        );
        iframe.contentWindow.postMessage(
          { type: "show", event: "initial.fetch", payload: data, data: data },
          "*",
        );
      })
      .catch(() => {
        // best-effort — Realtime events will refresh once data lands
      });

    return () => {
      cancelled = true;
    };
  }, [overlayKey, currentSessionId, currentToken, iframeLoaded, active]);

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
    if (!currentSessionId) return;
    const sb = getBrowserSupabase();
    const channel = sb.channel(REALTIME.channel(currentSessionId), {
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
      // 2026-04-26 — Bug 2 fix: data-driven overlays (match-scores-day,
      // leaderboard, top-scorers) receive Trigger payloads with empty
      // arrays (`rows: []`) because the broadcast control card just
      // re-fires the entry animation — the live data lives behind the
      // INITIAL_FETCH_PATH endpoint. If we forward only the trigger
      // payload, the iframe would render empty rows on Trigger and
      // would not repaint until the next score.changed / match.ended
      // event. So when the overlay key has an INITIAL_FETCH_PATH
      // builder + we have a session, refetch the fresh data and
      // forward THAT alongside `show`. Other (non-data-driven) keys
      // fall through to the original payload-only path.
      const builder = INITIAL_FETCH_PATH[overlayKey];
      if (builder && currentSessionId) {
        const url = builder(currentSessionId, overlayKey);
        const fetchUrl = currentToken
          ? `${url}${url.includes("?") ? "&" : "?"}t=${encodeURIComponent(currentToken)}`
          : url;
        // Show first so the entry animation begins immediately, then
        // post `update` once the fresh data lands. The HTML's update()
        // is idempotent with respect to the visibility class.
        postToInner({ type: "show", data: payload ?? null });
        fetch(fetchUrl, { cache: "no-store" })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data) {
              postToInner({
                type: "update",
                event: "trigger.refresh",
                payload: data,
                data: data,
              });
            }
          })
          .catch(() => {
            /* swallow — Realtime score.changed will refresh next tick */
          });
        return;
      }
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
      // 2026-04-26 slot-filter: when this injector is scoped to a single
      // slot (mini-preview cards), drop realtime events targeting other
      // slots so card 1's iframe never renders slot 2's trigger.
      if (slot != null && m.instanceSlot != null && m.instanceSlot !== slot) {
        return;
      }
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
      // Same slot-filter guard as instance.triggered.
      if (slot != null && m.instanceSlot != null && m.instanceSlot !== slot) {
        return;
      }
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
  }, [overlayKey, currentSessionId, currentToken, slot]);

  /* --------------------------------------------------------------- *
   * 1b. Data feed — public:standings:<seasonId> (existing behaviour) *
   *                                                                 *
   * Bug 4 fix (2026-04-26) — the SQL realtime.send payload for       *
   * `standings.changed` is just `{seasonId, at}` (see migration      *
   * 20260518000100). Forwarding it as-is would leave the iframe with *
   * no rows to render. So when we receive an event AND the overlay   *
   * has an `INITIAL_FETCH_PATH` builder, we re-fetch the fresh       *
   * payload from `/api/broadcast/sessions/<id>/<feed>` and post it to *
   * the iframe — same shape as the initial-mount fetch. This is the  *
   * live-update wire that links result-entry → leaderboard repaint.  *
   * --------------------------------------------------------------- */
  useEffect(() => {
    if (!currentSeasonId) return;
    const events = REALTIME_KEY_EVENTS[overlayKey];
    if (!events || events.length === 0) return;

    const sb = getBrowserSupabase();
    const channel = sb.channel(REALTIME.standingsChannel(currentSeasonId), {
      config: { broadcast: { self: false } },
    });

    const fetchBuilder = INITIAL_FETCH_PATH[overlayKey];

    async function refetchAndPost(
      event: KeyEvent,
      origPayload: unknown,
    ): Promise<void> {
      const iframe = iframeRef.current;
      if (!iframe || !iframe.contentWindow) return;
      // No initial-fetch path → forward the bare Realtime payload as
      // before. This preserves prior behaviour for score.changed on
      // 09-secondary-score-bug (the SQL realtime.send carries the score
      // delta itself, no API roundtrip needed).
      if (!fetchBuilder || !currentSessionId) {
        iframe.contentWindow.postMessage(
          { type: "update", event, payload: origPayload ?? null },
          "*",
        );
        return;
      }
      try {
        const url = fetchBuilder(currentSessionId, overlayKey);
        const fetchUrl = currentToken
          ? `${url}${url.includes("?") ? "&" : "?"}t=${encodeURIComponent(currentToken)}`
          : url;
        const res = await fetch(fetchUrl, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const ifr = iframeRef.current;
        if (!ifr || !ifr.contentWindow) return;
        ifr.contentWindow.postMessage(
          { type: "update", event, payload: data, data: data },
          "*",
        );
      } catch {
        /* swallow — Realtime will re-fire on next change */
      }
    }

    for (const event of events) {
      channel.on("broadcast", { event }, (msg) => {
        void refetchAndPost(event, msg.payload);
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
  }, [overlayKey, currentSeasonId, currentSessionId, currentToken]);

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
      // 2026-04-26 slot-filter: when scoped to a single slot, drop
      // relayed messages whose `slot` field is set AND does not match.
      if (slot != null) {
        const data = e.data as { slot?: number };
        if (data.slot != null && Number(data.slot) !== slot) return;
      }
      iframe.contentWindow.postMessage(e.data, "*");
    }
    window.addEventListener("message", relay);
    return () => window.removeEventListener("message", relay);
  }, [slot]);

  // Pass session + token in the iframe URL so HTML-side handlers that opt
  // into auth can grab them via `URLSearchParams`. They're optional.
  // Note: we use `currentSessionId` (state) so that when the ambient poll
  // swaps the active session the static HTML reloads with the new param.
  const params = new URLSearchParams();
  if (currentSessionId) params.set("session", currentSessionId);
  if (currentToken) params.set("token", currentToken);
  // 2026-04-26 lower-third slot isolation — when scoped to a single
  // slot, the static HTML reads `?slot=N` to hide the other anchors +
  // filter postMessages. Live (OBS) URLs leave it unset.
  if (slot != null) params.set("slot", String(slot));
  // 2026-04-28 Bug #25 — forward `?demo=1` from the SSR wrapper into the
  // iframe URL so the static HTML's `data-tag="cade-demo-mode"` script
  // (gated on `?demo=1` per CLAUDE.md §14) actually fires. Without this
  // the demo cycle was lost between `/overlay/v2/<key>?demo=1` and the
  // inner `/overlays/v2/<key>/index.html` source. Always emit a literal
  // `1` so the static HTML's strict equality check passes regardless of
  // which truthy form the caller used (`1` / `true` / `yes`).
  if (demo) params.set("demo", "1");
  // Phase A — overlay design tokens are forwarded via b64-JSON query
  // params. The static HTML's inline bootstrap script decodes them and
  // appends a `<style id="cade-injected-tokens">` block to its own
  // `<head>` so the persisted tokens + admin live-preview overrides
  // actually reach the rendered iframe (CSS variables don't cross
  // document boundaries — the SSR `<style>` blocks on the outer page
  // were never visible inside the iframe).
  if (designTokens && Object.keys(designTokens).length > 0) {
    const enc = encodeTokensParam(designTokens);
    if (enc) params.set("tokens", enc);
  }
  if (previewTokens && Object.keys(previewTokens).length > 0) {
    const enc = encodeTokensParam(previewTokens);
    if (enc) params.set("previewTokens", enc);
  }
  // Wave 2 Stage 2 — text-element overrides flow through their own b64
  // params. Bootstrap script in each overlay HTML decodes them and
  // applies content / inline-style edits to elements with matching
  // `data-element-id`. Empty maps skip the param to keep the URL clean.
  if (designTextTokens && Object.keys(designTextTokens).length > 0) {
    const enc = encodeTextTokensParam(
      designTextTokens as unknown as Record<string, unknown>,
    );
    if (enc) params.set("textTokens", enc);
  }
  if (previewTextTokens && Object.keys(previewTextTokens).length > 0) {
    const enc = encodeTextTokensParam(
      previewTextTokens as unknown as Record<string, unknown>,
    );
    if (enc) params.set("previewTextTokens", enc);
  }
  // Wave 2 Stage 3 — partner-strip + logo roster overrides.
  // Bootstrap rebuilds the partner-strip container's <img> children +
  // applies layout CSS (transform / orientation / spacing / position).
  // Empty maps skip the URL param to keep the iframe URL clean.
  if (
    designPartnerTokens &&
    (designPartnerTokens.layout != null ||
      (designPartnerTokens.logos && designPartnerTokens.logos.length > 0))
  ) {
    const enc = encodeTextTokensParam(
      designPartnerTokens as unknown as Record<string, unknown>,
    );
    if (enc) params.set("partnerTokens", enc);
  }
  if (
    previewPartnerTokens &&
    (previewPartnerTokens.layout != null ||
      (previewPartnerTokens.logos &&
        previewPartnerTokens.logos.length > 0))
  ) {
    const enc = encodeTextTokensParam(
      previewPartnerTokens as unknown as Record<string, unknown>,
    );
    if (enc) params.set("previewPartnerTokens", enc);
  }
  // Wave 2 Stage 4 — element-animation overrides ride the same b64-JSON
  // wire as text/partner tokens. Bootstrap decodes the param and emits
  // <style id="cade-injected-anim-keyframes"> + <style id="cade-injected-
  // anim-rules"> blocks scoped to body.cade-visible / body.cade-exiting
  // for phase-aware triggering.
  if (designAnimTokens && Object.keys(designAnimTokens).length > 0) {
    const enc = encodeTextTokensParam(
      designAnimTokens as unknown as Record<string, unknown>,
    );
    if (enc) params.set("animTokens", enc);
  }
  if (previewAnimTokens && Object.keys(previewAnimTokens).length > 0) {
    const enc = encodeTextTokensParam(
      previewAnimTokens as unknown as Record<string, unknown>,
    );
    if (enc) params.set("previewAnimTokens", enc);
  }
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
