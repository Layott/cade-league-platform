"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  V2_OVERLAY_LABELS,
  v2OverlayUrl,
  type V2OverlayKey,
} from "./overlay-keys";
import {
  computeFallbackDelay,
  lazyMountStageStyle,
} from "@/server/broadcast/v2/lazy_mount";

/**
 * Plan 51 — base ControlCard for the broadcast v2 control room.
 *
 * Each overlay tile renders:
 *   - A lazy-mounted iframe preview at 480 × 270 (1920×1080 / 4) wired
 *     to `/overlay/v2/<key>?session=<id>&token=<token>&preview=1`.
 *   - A copy-URL button that copies the absolute browser-source URL
 *     (without `&preview=1` so OBS / vMix get the live overlay path).
 *   - The label + key# header.
 *   - An optional `editPanel` slot the per-control component fills with
 *     its own inputs/dropdowns.
 *   - The footer ENTER + OUT row supplied by `triggerSlot`.
 *
 * The lazy-mount + content-visibility strategy is shared with the legacy
 * `OverlayMiniPreview`. We additionally emit an `iframeRef` callback so
 * specific control implementations can postMessage live data into the
 * preview frame as the operator types (matches the static mockup
 * behavior at KNOWLEDGE/brand-assets/elements/v2/index.html).
 */

const TILE_WIDTH = 480;
const TILE_HEIGHT = Math.round(TILE_WIDTH * (9 / 16)); // 270
const IFRAME_WIDTH = 1920;
const IFRAME_HEIGHT = 1080;
const SCALE = TILE_WIDTH / IFRAME_WIDTH;

export type ControlCardProps = {
  overlayKey: V2OverlayKey;
  sessionId: string;
  viewToken: string | null;
  /** Inline editor body (inputs, dropdowns, presets). Empty for no-edit cards. */
  editPanel?: ReactNode;
  /**
   * The footer row containing ENTER + OUT controls. Caller renders the
   * concrete <form action={triggerOverlayEnterAction}> + OFF form so each
   * control can attach its own hidden payload field.
   */
  triggerSlot: ReactNode;
  /**
   * Optional ref callback that receives the underlying iframe element
   * once mounted. Used by controls that postMessage into the iframe
   * (e.g. lower_third 3-slot UI updates without round-tripping the DB).
   */
  onIframeReady?: (iframe: HTMLIFrameElement | null) => void;
  /**
   * When true, renders a small "LIVE" pill in the header strip so
   * EDITABLE controls (which don't morph their button label on active)
   * still surface live state to operators. Optional — SIMPLE controls
   * leave this off because the button itself flips ON↔OFF.
   */
  liveBadge?: boolean;
  /**
   * Optional override for the header label. Defaults to
   * `V2_OVERLAY_LABELS[overlayKey]`. Used when the same overlayKey is
   * rendered in multiple cards (e.g. 3 lower-third slot cards) so each
   * gets a distinct title like "Lower Third 1", "Lower Third 2", etc.
   */
  labelOverride?: string;
  /**
   * Optional suffix appended to every internal `data-testid` so multiple
   * cards rendering the same overlayKey produce unique test handles.
   * Pass e.g. `"slot-1"` to get `v2-card-08-lower-third-slot-1`,
   * `v2-preview-iframe-08-lower-third-slot-1`, etc. When omitted, the
   * test ids match the legacy single-card layout (one per overlayKey).
   */
  instanceSuffix?: string;
  /**
   * S2 smoke fix (2026-04-26) — Bug CC#2.
   *
   * Whether this overlay is currently triggered on stream (server has
   * a row in `overlay_events` / `overlay_active_instances`). Forwarded
   * to the preview URL so `OverlayDataInjector` can gate its initial
   * data-fetch + auto-show on actual server state. Without this flag
   * data-driven mini-previews (orgs / coaches / penalties) always look
   * "live" regardless of what's actually on stream — operator
   * confusion risk.
   *
   * Live (OBS) URLs DO NOT receive this flag — `v2OverlayUrl` only
   * appends `active` when `preview=true`. Realtime updates still flow
   * through the channel subscription, so server state changes during
   * a session repaint the preview correctly.
   */
  active?: boolean;
  /**
   * 2026-04-26 lower-third slot isolation — when this card is one of the
   * 3 simultaneous lower-third slots, pass `slot=1|2|3` so the preview
   * URL gets `?slot=N`. The HTML hides the other 2 anchors + drops any
   * incoming postMessage / realtime that targets a different slot. Live
   * (OBS) URLs are unaffected — copy-URL emits the URL without slot.
   */
  previewSlot?: 1 | 2 | 3;
};

export function ControlCard({
  overlayKey,
  sessionId,
  viewToken,
  editPanel,
  triggerSlot,
  onIframeReady,
  liveBadge = false,
  labelOverride,
  instanceSuffix,
  active = false,
  previewSlot,
}: ControlCardProps) {
  const previewUrl = v2OverlayUrl(
    overlayKey,
    sessionId,
    viewToken,
    true,
    active,
    previewSlot ?? null,
  );
  // Live URL for clipboard / open-in-new-tab.
  // 2026-04-26: lower-third LIVE URLs MUST carry `?slot=N` so OBS gets
  // 3 distinct browser-source URLs (one per slot anchor). Without slot
  // in the live URL all 3 cards' "COPY URL" produced identical strings —
  // operators can't drop them as 3 separate browser sources. The static
  // HTML reads `?slot=N` to render only that slot anchor on stream.
  const liveUrl = v2OverlayUrl(
    overlayKey,
    sessionId,
    viewToken,
    false,
    false,
    previewSlot ?? null,
  );
  const idSuffix = instanceSuffix ? `${overlayKey}-${instanceSuffix}` : overlayKey;

  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [absoluteLiveUrl, setAbsoluteLiveUrl] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Lazy-mount the iframe via IntersectionObserver + idle fallback.
  // Mirrors `createLazyMountController` from the shared util but inlined
  // so React re-renders don't lose the latched `mounted` flag.
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

    const fallback = computeFallbackDelay(el, 400, 0.4, 2400);
    idleHandle = setTimeout(mountNow, fallback);

    return () => {
      cancelled = true;
      if (io) io.disconnect();
      if (idleHandle) clearTimeout(idleHandle);
    };
  }, [mounted]);

  // Compute absolute URL for clipboard once the window object is ready.
  useMemo(() => {
    if (typeof window !== "undefined") {
      setAbsoluteLiveUrl(`${window.location.origin}${liveUrl}`);
    }
  }, [liveUrl]);

  // Surface the iframe ref to the parent control once mounted so it can
  // postMessage live updates while the operator is still typing.
  useEffect(() => {
    if (!onIframeReady) return;
    if (mounted) {
      onIframeReady(iframeRef.current);
    } else {
      onIframeReady(null);
    }
  }, [mounted, onIframeReady]);

  const handleCopy = useCallback(async () => {
    const url = absoluteLiveUrl ?? liveUrl;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      window.prompt("Copy overlay URL:", url);
    }
  }, [absoluteLiveUrl, liveUrl]);

  const label = labelOverride ?? V2_OVERLAY_LABELS[overlayKey];
  const num = overlayKey.split("-")[0];

  return (
    <div
      className="flex flex-col overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]"
      data-testid={`v2-card-${idSuffix}`}
      style={lazyMountStageStyle({
        tileWidth: TILE_WIDTH,
        tileHeight: TILE_HEIGHT,
      })}
    >
      {/* Iframe preview stage */}
      <div
        ref={stageRef}
        data-testid={`v2-preview-stage-${idSuffix}`}
        data-mounted={mounted ? "true" : "false"}
        style={{
          width: `${TILE_WIDTH}px`,
          height: `${TILE_HEIGHT}px`,
          overflow: "hidden",
          background: "#000",
          position: "relative",
          margin: "0 auto",
        }}
      >
        {mounted ? (
          <iframe
            ref={iframeRef}
            src={previewUrl}
            title={`Preview — ${label}`}
            data-testid={`v2-preview-iframe-${idSuffix}`}
            style={{
              width: `${IFRAME_WIDTH}px`,
              height: `${IFRAME_HEIGHT}px`,
              border: "none",
              transform: `scale(${SCALE})`,
              transformOrigin: "top left",
              pointerEvents: "none",
              background: "transparent",
              colorScheme: "normal",
            }}
            sandbox="allow-scripts allow-same-origin"
            loading="lazy"
            allowTransparency
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
              fontSize: 12,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
            }}
          >
            loading preview…
          </div>
        )}
      </div>

      {/* Header strip — key # + label + copy URL + open in new tab */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--ink-4)]/70 bg-[var(--ink-3)]/40 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-[10px] font-semibold tracking-[0.16em] text-[var(--signal)]">
            #{num}
          </span>
          <span
            className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--chalk-1)]"
            title={label}
          >
            {label}
          </span>
          {liveBadge ? (
            <span
              data-testid={`v2-live-badge-${idSuffix}`}
              className="inline-flex items-center gap-1 rounded-sm border border-[rgba(255,91,59,0.55)] bg-[rgba(255,91,59,0.15)] px-1.5 py-[1px] font-mono text-[8px] font-bold uppercase tracking-[0.2em] text-[var(--flare)]"
              title="Overlay is currently live"
              aria-label="Overlay is live"
            >
              <span
                className="inline-block h-[5px] w-[5px] rounded-full bg-[var(--flare)] animate-pulse"
                aria-hidden="true"
              />
              Live
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopy}
            data-testid={`v2-copy-${idSuffix}`}
            className="rounded-sm border border-[var(--ink-4)] bg-transparent px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-2)] hover:border-[var(--signal)]/40 hover:text-[var(--signal)]"
            aria-label={`Copy browser source URL for ${label}`}
          >
            {copied ? "Copied" : "Copy URL"}
          </button>
          <a
            href={liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`v2-open-${idSuffix}`}
            className="rounded-sm border border-[var(--signal)]/40 bg-transparent px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--signal)] hover:bg-[var(--signal)]/10"
            aria-label={`Open ${label} in a new tab`}
          >
            Open ↗
          </a>
        </div>
      </div>

      {/* Edit panel slot — control-specific inputs */}
      {editPanel ? (
        <div
          className="border-b border-[var(--ink-4)]/40 bg-[var(--ink-2)] p-3"
          data-testid={`v2-edit-${idSuffix}`}
        >
          {editPanel}
        </div>
      ) : null}

      {/* Trigger ENTER / OUT footer */}
      <div className="mt-auto flex items-center gap-2 px-3 py-3">
        {triggerSlot}
      </div>
    </div>
  );
}

/**
 * Helper exported so individual controls can safely postMessage into the
 * card's iframe. Mirrors the static mockup's `postTo()` helper.
 */
export function postToFrame(
  iframe: HTMLIFrameElement | null,
  message: unknown,
): void {
  if (!iframe || !iframe.contentWindow) return;
  try {
    iframe.contentWindow.postMessage(message, "*");
  } catch {
    // swallow — posting to closed window or wrong origin
  }
}
