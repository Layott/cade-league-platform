"use client";

import { useEffect, useState, useCallback } from "react";
import { getTemplateRoute, type TemplateKey } from "@/server/overlays/registry";

/**
 * Audit Slice 1 (2026-04-24) — live preview iframe for data-feed overlays.
 *
 * Opens a modal with a pixel-perfect scaled iframe loading the actual
 * overlay URL (`/overlay/<key>?session=<id>&t=<viewToken>&preview=1`)
 * so the operator can see what viewers will see on-stream BEFORE
 * triggering the overlay.
 *
 * The iframe renders the full 1920x1080 browser source; CSS transform-
 * scale(0.25) fits it into a 480x270 preview tile. The overlay's own
 * OverlayFrame wrapper respects `?preview=1` by enabling the preview
 * loop (usePreviewMode) — so even if the real DB has no standings yet,
 * the design visuals still animate on the 8s cycle.
 *
 * Controls:
 *   - Close button
 *   - Open-in-tab link for full-size inspection
 *
 * Used by the admin broadcast page's legacy-trigger grid (Plan 12 +
 * Plan 16 + Slice 1) — a Preview button sits beside each "Trigger"
 * button for the 3 data-feed templates: leaderboard_animated,
 * top_scorers, match_scores_day.
 */

export type PreviewIframeModalProps = {
  sessionId: string;
  viewToken: string | null;
  templateKey: TemplateKey;
  onClose: () => void;
};

export function PreviewIframeModal(props: PreviewIframeModalProps) {
  const { sessionId, viewToken, templateKey, onClose } = props;

  const overlayRoute = getTemplateRoute(templateKey);
  // preview=1 enables usePreviewMode's animation loop (8 s cycle with a
  // synthetic cycle counter). Without it, the overlay only renders when
  // live data is present, which isn't useful for a pre-trigger preview.
  //
  // We also pass `?session=<id>&t=<token>` so the real API fetch still
  // runs — the operator sees LIVE data if it exists, or the preview-
  // sample payload if the overlay page synthesized one.
  const previewUrl = `${overlayRoute}?session=${encodeURIComponent(
    sessionId,
  )}${viewToken ? `&t=${encodeURIComponent(viewToken)}` : ""}&preview=1`;

  const handleKeyDown = useCallback(
    (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    // Lock body scroll while open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prev;
    };
  }, [handleKeyDown]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid={`preview-modal-${templateKey}`}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(5,6,7,0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
      onClick={(e) => {
        // Backdrop click dismisses the modal; clicks inside the card
        // bubble up but are stopped below.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "var(--ink-2)",
          border: "1px solid var(--ink-4)",
          borderRadius: 6,
          padding: 20,
          maxWidth: 560,
          width: "100%",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <h3
            className="font-broadcast-accent"
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "var(--chalk-0)",
              letterSpacing: "3px",
              textTransform: "uppercase",
              margin: 0,
            }}
          >
            Live preview · {templateKey.replace(/_/g, " ")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            data-testid={`preview-modal-close-${templateKey}`}
            style={{
              background: "transparent",
              border: "1px solid var(--ink-4)",
              color: "var(--chalk-1)",
              padding: "4px 10px",
              borderRadius: 3,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>

        {/* 480x270 wrapper scales a 1920x1080 iframe down to 25%.
            The iframe itself renders at real-world size so font
            metrics, images, and motion match exactly what viewers
            see on-stream. */}
        <div
          style={{
            width: 480,
            height: 270,
            overflow: "hidden",
            border: "1px solid var(--ink-4)",
            borderRadius: 4,
            background: "#000",
            margin: "0 auto",
            position: "relative",
          }}
        >
          <iframe
            src={previewUrl}
            title={`Preview — ${templateKey}`}
            data-testid={`preview-iframe-${templateKey}`}
            style={{
              width: 1920,
              height: 1080,
              border: "none",
              transform: "scale(0.25)",
              transformOrigin: "top left",
            }}
          />
        </div>

        <div
          style={{
            marginTop: 16,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 11,
            color: "var(--chalk-3)",
          }}
        >
          <span>
            Scaled 25% · browser source is 1920×1080 · real DB + preview
            loop
          </span>
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`preview-modal-open-${templateKey}`}
            style={{
              color: "var(--primary)",
              textDecoration: "none",
              fontWeight: 600,
              letterSpacing: "1px",
              textTransform: "uppercase",
              fontSize: 11,
            }}
          >
            Open full-size ↗
          </a>
        </div>
      </div>
    </div>
  );
}

/**
 * Trigger button + modal controller. Keeps the open/close state local
 * so the parent admin page can drop in a `<PreviewIframeTrigger>` per
 * overlay trigger-card without lifting state.
 */
export function PreviewIframeTrigger(props: {
  sessionId: string;
  viewToken: string | null;
  templateKey: TemplateKey;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid={`preview-btn-${props.templateKey}`}
        className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--chalk-2)] hover:text-[var(--signal)]"
        style={{
          background: "transparent",
          border: "1px solid var(--ink-4)",
          borderRadius: 3,
          padding: "3px 8px",
          cursor: "pointer",
        }}
      >
        Preview
      </button>
      {open ? (
        <PreviewIframeModal
          sessionId={props.sessionId}
          viewToken={props.viewToken}
          templateKey={props.templateKey}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
