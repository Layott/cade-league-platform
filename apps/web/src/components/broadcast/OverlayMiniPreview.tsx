"use client";

import { useCallback, useMemo, useState } from "react";
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
