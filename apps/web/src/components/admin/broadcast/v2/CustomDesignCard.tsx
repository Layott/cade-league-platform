"use client";

import { useEffect, useRef, useState } from "react";

export type CustomDesignSummary = {
  id: string;
  slug: string;
  title: string;
  thumbnailUrl: string | null;
  overlayKey: `user-${string}`;
};

export type CustomDesignCardProps = {
  design: CustomDesignSummary;
  sessionId: string;
  viewToken: string | null;
  canTrigger: boolean;
  onTrigger: (args: { overlayKey: string; sessionId: string }) => void | Promise<unknown>;
  onHide: (args: { overlayKey: string; sessionId: string }) => void | Promise<unknown>;
};

const TILE_WIDTH = 480;
const TILE_HEIGHT = 270;
const IFRAME_WIDTH = 1920;
const IFRAME_HEIGHT = 1080;
const SCALE = TILE_WIDTH / IFRAME_WIDTH;

function buildPreviewUrl(
  slug: string,
  sessionId: string,
  viewToken: string | null,
): string {
  const params = new URLSearchParams();
  params.set("sessionId", sessionId);
  if (viewToken) params.set("token", viewToken);
  params.set("preview", "1");
  return `/overlay/v2/user/${slug}?${params.toString()}`;
}

export function CustomDesignCard({
  design,
  sessionId,
  viewToken,
  canTrigger,
  onTrigger,
  onHide,
}: CustomDesignCardProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (mounted) return;
    const el = stageRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setMounted(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setMounted(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: "200px 0px", threshold: 0.01 },
    );
    io.observe(el);
    const fallback = setTimeout(() => setMounted(true), 1800);
    return () => {
      io.disconnect();
      clearTimeout(fallback);
    };
  }, [mounted]);

  const previewUrl = buildPreviewUrl(design.slug, sessionId, viewToken);

  const handleTrigger = () => {
    // postMessage show to iframe for optimistic preview
    const iframe = iframeRef.current;
    if (iframe?.contentWindow) {
      try {
        iframe.contentWindow.postMessage({ type: "show", data: {} }, "*");
      } catch {
        // swallow — cross-origin iframe or closed window
      }
    }
    void onTrigger({ overlayKey: design.overlayKey, sessionId });
  };

  const handleHide = () => {
    // postMessage hide to iframe for optimistic preview
    const iframe = iframeRef.current;
    if (iframe?.contentWindow) {
      try {
        iframe.contentWindow.postMessage({ type: "hide" }, "*");
      } catch {
        // swallow
      }
    }
    void onHide({ overlayKey: design.overlayKey, sessionId });
  };

  return (
    <div
      data-testid={`custom-design-card-${design.slug}`}
      className="flex flex-col overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]"
      style={{ width: `${TILE_WIDTH}px` }}
    >
      <div
        ref={stageRef}
        data-testid={`custom-preview-stage-${design.slug}`}
        style={{
          width: `${TILE_WIDTH}px`,
          height: `${TILE_HEIGHT}px`,
          overflow: "hidden",
          background: "#000",
          position: "relative",
        }}
      >
        {mounted ? (
          <iframe
            ref={iframeRef}
            src={previewUrl}
            title={`Preview — ${design.title}`}
            data-testid={`custom-preview-iframe-${design.slug}`}
            style={{
              width: `${IFRAME_WIDTH}px`,
              height: `${IFRAME_HEIGHT}px`,
              border: "none",
              transform: `scale(${SCALE})`,
              transformOrigin: "top left",
              pointerEvents: "none",
              background: "transparent",
            }}
            sandbox="allow-scripts allow-same-origin"
            loading="lazy"
          />
        ) : design.thumbnailUrl ? (
          <img
            alt={`Thumbnail for ${design.title}`}
            src={design.thumbnailUrl}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
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

      <div className="flex items-center justify-between gap-2 border-b border-[var(--ink-4)]/70 bg-[var(--ink-3)]/40 px-3 py-2">
        <span
          className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--chalk-1)]"
          title={design.title}
        >
          {design.title}
        </span>
        <span className="font-mono text-[9px] text-[var(--chalk-3)]">
          {design.overlayKey}
        </span>
      </div>

      <div className="flex items-center gap-2 px-3 py-3">
        <button
          type="button"
          data-testid={`custom-trigger-${design.slug}`}
          disabled={!canTrigger}
          onClick={handleTrigger}
          className="flex-1 rounded-sm border border-[var(--signal)]/40 bg-[var(--signal)]/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--signal)] hover:bg-[var(--signal)]/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Trigger
        </button>
        <button
          type="button"
          data-testid={`custom-hide-${design.slug}`}
          disabled={!canTrigger}
          onClick={handleHide}
          className="flex-1 rounded-sm border border-[var(--ink-4)] bg-transparent px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--chalk-2)] hover:border-[var(--flare)]/60 hover:text-[var(--flare)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Hide
        </button>
      </div>
    </div>
  );
}
