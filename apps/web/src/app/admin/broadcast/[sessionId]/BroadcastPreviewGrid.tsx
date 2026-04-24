"use client";

import { useCallback, useMemo, useState } from "react";
import {
  getTemplateRoute,
  type TemplateKey,
} from "@/server/overlays/registry";

/**
 * Plan 42.3 (2026-04-24) — inline mini-preview grid for the broadcast panel.
 *
 * Renders each overlay's actual route inside a pixel-perfect 1920×1080
 * iframe, CSS-scaled to a compact preview tile. This lets the producer see
 * exactly what viewers see on-stream WITHOUT leaving the control page —
 * and because the iframes subscribe to the same realtime session, every
 * trigger / score +1 / clear reflects live.
 *
 * Grid layout:
 *   - Match-aware templates (score_bug, lower_third, h2h_2, up_next_bug,
 *     stinger_goal) render once per slot (primary / secondary) via
 *     `?slot=<slot>` so both concurrent matches can be monitored.
 *   - Session-scoped templates (scorebar, standings, leaderboard, etc.)
 *     render once without a slot param.
 *
 * Each tile also exposes a Copy URL button so the admin can paste the
 * browser-source URL into OBS / vMix / Streamlabs without switching tabs.
 *
 * IMPORTANT: Each iframe holds its own Realtime subscription. To keep the
 * grid light we limit the default visible set to the templates producers
 * watch most — the admin can expand the full set via the toggle.
 */

const SLOT_CAPABLE: ReadonlySet<TemplateKey> = new Set([
  "score_bug",
  "lower_third",
  "up_next_bug",
  "h2h_2",
  "h2h_3",
  "h2h_5",
  "stinger_goal",
  "stinger_miss",
  "layout_timer",
  "leaderboard_animated",
  "top_scorers",
  "match_scores_day",
  "orgs_roster",
  "coach_intros",
  "player_penalties",
]);

/** Default tiles shown above the fold. Producers watch these every session. */
const DEFAULT_TILES: ReadonlyArray<TemplateKey> = [
  "score_bug",
  "layout_timer",
  "lower_third",
  "featured_comment",
  "scorebar",
  "leaderboard_animated",
];

/** Full catalog, ordered by producer frequency. Exposed via the "Show all"
 *  toggle so the panel stays light by default. Skips pure-trigger stingers
 *  and intro/outro/stream_ended which are rarely worth an always-on iframe. */
const EXPANDED_TILES: ReadonlyArray<TemplateKey> = [
  "score_bug",
  "layout_timer",
  "lower_third",
  "featured_comment",
  "scorebar",
  "leaderboard_animated",
  "top_scorers",
  "match_scores_day",
  "up_next_bug",
  "h2h_2",
  "h2h_3",
  "h2h_5",
  "player_card",
  "standings_widget",
  "punishment_ticker",
  "orgs_roster",
  "coach_intros",
  "player_penalties",
  "layout_4pip",
  "layout_2pip",
  "layout_brb_full",
  "layout_brb_basic",
  "layout_casters_chat",
  "layout_animated_bg",
  "starting_soon_basic",
  "starting_soon_timer",
];

export type BroadcastPreviewGridProps = {
  sessionId: string;
  viewToken: string | null;
};

export function BroadcastPreviewGrid({
  sessionId,
  viewToken,
}: BroadcastPreviewGridProps) {
  const [expanded, setExpanded] = useState(false);
  const tiles = expanded ? EXPANDED_TILES : DEFAULT_TILES;

  return (
    <section
      className="space-y-3"
      data-testid="broadcast-preview-grid"
      aria-label="Live overlay previews"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--chalk-3)]">
            Live preview
          </h2>
          <div className="mt-0.5 text-[10px] text-[var(--chalk-3)]">
            Mini iframes — same URL as the browser source. Score +1 / trigger
            any overlay and the tile reflects it live.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          data-testid="preview-grid-expand-toggle"
          className="rounded-sm border border-[var(--ink-4)] bg-transparent px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-2)] hover:border-[var(--signal)]/50 hover:text-[var(--signal)]"
        >
          {expanded ? "Show defaults" : `Show all (${EXPANDED_TILES.length})`}
        </button>
      </div>

      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        }}
      >
        {tiles.flatMap((key) =>
          SLOT_CAPABLE.has(key)
            ? [
                <OverlayMiniPreview
                  key={`${key}-primary`}
                  sessionId={sessionId}
                  viewToken={viewToken}
                  templateKey={key}
                  slot="primary"
                />,
                <OverlayMiniPreview
                  key={`${key}-secondary`}
                  sessionId={sessionId}
                  viewToken={viewToken}
                  templateKey={key}
                  slot="secondary"
                />,
              ]
            : [
                <OverlayMiniPreview
                  key={key}
                  sessionId={sessionId}
                  viewToken={viewToken}
                  templateKey={key}
                />,
              ],
        )}
      </div>
    </section>
  );
}

/**
 * Single mini preview tile. Scales a 1920×1080 iframe (the actual overlay
 * route) down to fit a ~270×152 clipping wrapper. The iframe renders the
 * live browser source so realtime events restage AnimatePresence within.
 */
function OverlayMiniPreview({
  sessionId,
  viewToken,
  templateKey,
  slot,
}: {
  sessionId: string;
  viewToken: string | null;
  templateKey: TemplateKey;
  slot?: "primary" | "secondary";
}) {
  const overlayRoute = getTemplateRoute(templateKey);
  const params = new URLSearchParams();
  params.set("session", sessionId);
  if (slot) params.set("slot", slot);
  if (viewToken) params.set("t", viewToken);
  const overlayUrl = `${overlayRoute}?${params.toString()}`;

  // Scale factor: iframe renders at 1920×1080; tile is 270×152 (16:9 at
  // ~14% scale). 270 / 1920 ≈ 0.1406.
  const scale = 270 / 1920;
  const iframeWidth = 1920;
  const iframeHeight = 1080;
  const tileWidth = Math.round(iframeWidth * scale);
  const tileHeight = Math.round(iframeHeight * scale);

  const [copied, setCopied] = useState(false);
  const [absoluteUrl, setAbsoluteUrl] = useState<string | null>(null);

  // Compute the absolute URL client-side so copy-to-clipboard carries a full
  // https://.../overlay/... link into OBS / vMix. Falls back to relative if
  // window isn't available (SSR).
  useMemo(() => {
    if (typeof window !== "undefined") {
      setAbsoluteUrl(`${window.location.origin}${overlayUrl}`);
    }
  }, [overlayUrl]);

  const handleCopy = useCallback(async () => {
    const url = absoluteUrl ?? overlayUrl;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Fallback: prompt() so the user can still copy on older browsers.
      window.prompt("Copy overlay URL:", url);
    }
  }, [absoluteUrl, overlayUrl]);

  const labelBase = templateKey
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
  const label = slot ? `${labelBase} · ${slot}` : labelBase;

  return (
    <div
      className="overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]"
      data-testid={`mini-preview-${templateKey}${slot ? `-${slot}` : ""}`}
    >
      {/* Header strip — label + slot pill + copy/open actions */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--ink-4)]/70 bg-[var(--ink-3)]/40 px-2 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--chalk-1)]"
            title={label}
          >
            {label}
          </span>
          {slot ? (
            <span
              className="whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.2em]"
              style={{
                color:
                  slot === "primary" ? "var(--signal)" : "var(--flare)",
                border: `1px solid ${
                  slot === "primary"
                    ? "rgba(107, 205, 6, 0.4)"
                    : "rgba(254, 3, 109, 0.4)"
                }`,
                background:
                  slot === "primary"
                    ? "rgba(107, 205, 6, 0.08)"
                    : "rgba(254, 3, 109, 0.08)",
              }}
            >
              {slot}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopy}
            data-testid={`mini-preview-copy-${templateKey}${slot ? `-${slot}` : ""}`}
            className="rounded-sm border border-[var(--ink-4)] bg-transparent px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-2)] hover:border-[var(--signal)]/40 hover:text-[var(--signal)]"
            aria-label={`Copy browser source URL for ${label}`}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <a
            href={overlayUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`mini-preview-open-${templateKey}${slot ? `-${slot}` : ""}`}
            className="rounded-sm border border-[var(--signal)]/40 bg-transparent px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--signal)] hover:bg-[var(--signal)]/10"
            aria-label={`Open ${label} in a new tab`}
          >
            Open
          </a>
        </div>
      </div>

      {/* Iframe stage — clipping wrapper + transform-scaled 1920×1080 iframe */}
      <div
        style={{
          width: `${tileWidth}px`,
          height: `${tileHeight}px`,
          overflow: "hidden",
          background: "#000",
          position: "relative",
          margin: "0 auto",
        }}
      >
        <iframe
          src={overlayUrl}
          title={`Mini preview — ${label}`}
          data-testid={`mini-preview-iframe-${templateKey}${slot ? `-${slot}` : ""}`}
          style={{
            width: `${iframeWidth}px`,
            height: `${iframeHeight}px`,
            border: "none",
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            pointerEvents: "none",
          }}
          sandbox="allow-scripts allow-same-origin"
          loading="lazy"
        />
      </div>
    </div>
  );
}
