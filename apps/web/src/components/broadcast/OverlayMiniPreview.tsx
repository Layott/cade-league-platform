"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getTemplateRoute,
  type TemplateKey,
} from "@/server/overlays/registry";

/**
 * Plan 42.3 / Plan 48.3 — inline mini-preview tile.
 *
 * Extracted out of the old `BroadcastPreviewGrid` (now unused) so every
 * `EditableTemplatePanel` + legacy trigger card can mount its own live
 * iframe next to the controls. The producer sees a change take effect the
 * moment the trigger / edit / +1 button fires.
 *
 * Scales a 1920×1080 iframe (pointed at the actual overlay route) down to
 * the requested tile size via CSS transform. The iframe holds its own
 * Realtime subscription — same URL the OBS / vMix browser source uses —
 * so entry / exit animations, score edits, clears all reflect live.
 *
 * `sandbox="allow-scripts allow-same-origin"` + `pointerEvents: none`
 * keep the mini from stealing clicks or navigating the admin page.
 *
 * Plan 48.4 (2026-04-24) — perf: /admin/broadcast/[sessionId] mounts 40+
 * tiles across editable panels + legacy trigger cards. Eagerly spawning
 * 40 concurrent Realtime WebSocket connections + 40 iframes (each laying
 * out a full 1920×1080 DOM at scale(0.14)) froze first paint for seconds.
 * Fix: IntersectionObserver-gated lazy mount. Each tile renders a sized
 * placeholder until it enters the viewport (rootMargin 200 px) — only
 * then do we inject the <iframe> + its subscription. `content-visibility:
 * auto` lets the browser skip paint/layout for off-screen tiles. Once
 * visible, the iframe stays mounted (no re-creation on scroll) so the
 * producer's muscle-memory of "trigger → see it in that card" is kept.
 */
export type OverlayMiniPreviewProps = {
  sessionId: string;
  viewToken: string | null;
  templateKey: TemplateKey;
  slot?: "primary" | "secondary";
  /** Rendered tile width in px. Default 320 for side-by-side layout. */
  tileWidth?: number;
  /** When true, render a compact header (label + slot pill only). */
  compact?: boolean;
  /** Optional label override (defaults to Title-Cased templateKey). */
  label?: string;
};

export function OverlayMiniPreview({
  sessionId,
  viewToken,
  templateKey,
  slot,
  tileWidth = 320,
  compact = false,
  label: labelOverride,
}: OverlayMiniPreviewProps) {
  const overlayRoute = getTemplateRoute(templateKey);
  const params = new URLSearchParams();
  params.set("session", sessionId);
  if (slot) params.set("slot", slot);
  if (viewToken) params.set("t", viewToken);
  const overlayUrl = `${overlayRoute}?${params.toString()}`;

  // Scale factor: iframe renders at 1920×1080; tile keeps 16:9 ratio.
  const scale = tileWidth / 1920;
  const iframeWidth = 1920;
  const iframeHeight = 1080;
  const tileHeight = Math.round(iframeHeight * scale);

  const [copied, setCopied] = useState(false);
  const [absoluteUrl, setAbsoluteUrl] = useState<string | null>(null);

  // Plan 48.4 — lazy-mount the iframe when the tile scrolls within
  // ~200 px of the viewport. Before that, we render a cheap placeholder.
  // `mounted` latches true on first visibility so scrolling past a tile
  // doesn't unmount + re-create the iframe (would drop its Realtime
  // subscription + re-hydrate the whole 1920×1080 DOM).
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (mounted) return;
    const el = stageRef.current;
    if (!el) return;

    let cancelled = false;
    let idleHandle: ReturnType<typeof setTimeout> | null = null;
    let io: IntersectionObserver | null = null;

    const mountNow = () => {
      if (cancelled) return;
      setMounted(true);
    };

    // Browsers without IntersectionObserver (older Chromium / SSR head-
    // less) — fall back to eager mount so the producer still sees
    // something.
    if (typeof IntersectionObserver === "undefined") {
      setMounted(true);
      return;
    }
    io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            mountNow();
            if (io) io.disconnect();
            if (idleHandle) clearTimeout(idleHandle);
            break;
          }
        }
      },
      { rootMargin: "200px 0px", threshold: 0.01 },
    );
    io.observe(el);

    // Plan 48.4 — belt + suspenders: if the tile never scrolls into view
    // (off-screen editable panels, below-the-fold legacy cards), still
    // mount the iframe after a staggered idle delay. 30 tiles × 80ms
    // stagger keeps the WebSocket spawn rate bounded while guaranteeing
    // every tile is live inside ~3s. We key the stagger off the stage
    // element's DOM position so the visible tiles mount first.
    //
    // Also — E2E specs (Playwright) bypass scroll + assert the iframe
    // is present. This fallback keeps that contract.
    const baseDelay = 400;
    let extraDelay = 0;
    try {
      const rect = el.getBoundingClientRect();
      // Elements further from the viewport wait proportionally longer.
      extraDelay = Math.min(2400, Math.max(0, rect.top) * 0.4);
    } catch {
      // ignore — only runs client-side.
    }
    idleHandle = setTimeout(mountNow, baseDelay + extraDelay);

    return () => {
      cancelled = true;
      if (io) io.disconnect();
      if (idleHandle) clearTimeout(idleHandle);
    };
  }, [mounted]);

  // Compute the absolute URL client-side so copy-to-clipboard carries a
  // full https://.../overlay/... link into OBS / vMix. Falls back to
  // relative if window isn't available (SSR).
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
      // Fallback: prompt() so older browsers can still copy.
      window.prompt("Copy overlay URL:", url);
    }
  }, [absoluteUrl, overlayUrl]);

  const labelBase =
    labelOverride ??
    templateKey
      .split("_")
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(" ");
  const label = slot ? `${labelBase} · ${slot}` : labelBase;

  return (
    <div
      className="overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]"
      data-testid={`mini-preview-${templateKey}${slot ? `-${slot}` : ""}`}
      style={{
        // `content-visibility: auto` lets the browser skip paint + layout
        // for tiles that are off-screen. `contain-intrinsic-size` gives
        // the browser a size hint so scroll-height stays stable while the
        // contents are skipped.
        contentVisibility: "auto",
        containIntrinsicSize: `${tileHeight + (compact ? 22 : 28)}px ${tileWidth}px`,
      }}
    >
      {/* Header strip — label + slot pill + copy/open actions */}
      <div
        className={`flex items-center justify-between gap-2 border-b border-[var(--ink-4)]/70 bg-[var(--ink-3)]/40 px-2 ${
          compact ? "py-1" : "py-1.5"
        }`}
      >
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

      {/* Iframe stage — clipping wrapper + transform-scaled 1920×1080 iframe.
          Tile starts with a cheap placeholder; only once IntersectionObserver
          reports it in the viewport do we inject the <iframe>. Stays mounted
          after first visibility (no scroll re-creation). */}
      <div
        ref={stageRef}
        data-testid={`mini-preview-stage-${templateKey}${slot ? `-${slot}` : ""}`}
        data-mounted={mounted ? "true" : "false"}
        style={{
          width: `${tileWidth}px`,
          height: `${tileHeight}px`,
          overflow: "hidden",
          background: "#000",
          position: "relative",
          margin: "0 auto",
        }}
      >
        {mounted ? (
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
        ) : (
          <div
            aria-hidden="true"
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background:
                "repeating-linear-gradient(135deg, rgba(107,205,6,0.04) 0 12px, transparent 12px 24px)",
              color: "rgba(107,205,6,0.55)",
              fontFamily: "Quedora, sans-serif",
              fontSize: Math.max(9, Math.round(tileWidth / 32)),
              letterSpacing: "0.22em",
              textTransform: "uppercase",
            }}
          >
            loading preview…
          </div>
        )}
      </div>
    </div>
  );
}
