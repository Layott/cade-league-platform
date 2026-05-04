"use client";

import { SIZE_PRESETS, type SocialSize } from "@/lib/social-sizes";
import type { TemplateKey } from "@/server/social/templates";

/**
 * Plan 54 Wave 2B — `<PreviewIframe>` renders the OG endpoint inside an
 * iframe scaled to fit the container.
 *
 * Sizing strategy mirrors the live-preview iframe scaling rule from
 * CLAUDE.md §15: iframe is sized at the canvas's NATIVE pixel dimensions,
 * the wrapper carries `container-type: inline-size`, and the iframe
 * `transform: scale(calc(100cqi / <native-width>px))` shrinks it to fit
 * the wrapper's actual width. `aspect-ratio: <w> / <h>` keeps the
 * wrapper proportional to the rendered canvas.
 *
 * The OG endpoint at `/api/social/og/<key>/<size>` is built by Wave 2A
 * (parallel). When that endpoint isn't live yet the iframe shows a 404 —
 * the rest of the admin page still works, the admin just sees an empty
 * preview frame.
 *
 * Spec: docs/superpowers/specs/2026-05-05-broadcast-social-media.md §6.
 */

export function PreviewIframe({
  templateKey,
  size,
  sessionId,
  viewToken,
}: {
  templateKey: TemplateKey;
  size: SocialSize;
  sessionId: string | null;
  viewToken?: string | null;
}) {
  const preset = SIZE_PRESETS[size];
  const aspectStr = `${preset.width} / ${preset.height}`;
  const tokenParam =
    sessionId && viewToken ? `&t=${encodeURIComponent(viewToken)}` : "";
  const sessionParam = sessionId
    ? `?session=${encodeURIComponent(sessionId)}${tokenParam}`
    : "";
  const src = `/api/social/og/${templateKey}/${size}${sessionParam}`;

  return (
    <div className="space-y-2" data-testid="preview-iframe-wrapper">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          Preview
        </h3>
        <span className="font-mono text-[10px] text-[var(--chalk-3)]">
          {preset.width}×{preset.height} · {preset.aspect}
        </span>
      </div>
      <div
        className="relative w-full overflow-hidden rounded-sm border border-[var(--ink-4)] bg-black"
        style={{
          aspectRatio: aspectStr,
          containerType: "inline-size",
        }}
      >
        {sessionId ? (
          <iframe
            src={src}
            data-testid="preview-iframe"
            className="absolute left-0 top-0"
            style={{
              width: `${preset.width}px`,
              height: `${preset.height}px`,
              transform: `scale(calc(100cqi / ${preset.width}px))`,
              transformOrigin: "top left",
              border: "none",
            }}
            sandbox="allow-scripts allow-same-origin"
          />
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center px-6 text-center text-xs text-[var(--chalk-3)]"
            data-testid="preview-no-session"
          >
            No active broadcast session — start one from{" "}
            <span className="ml-1 font-mono">/admin/broadcast/v2</span>
          </div>
        )}
      </div>
      <p className="text-[10px] text-[var(--chalk-3)]">
        Iframe renders <span className="font-mono">{src}</span>. The native
        canvas is {preset.width}×{preset.height}, scaled to fit the
        container.
      </p>
    </div>
  );
}
