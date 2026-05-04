"use client";

import { useState } from "react";
import { SizePicker } from "./SizePicker";
import { PreviewIframe } from "./PreviewIframe";
import { DownloadButton } from "./DownloadButton";
import type { SocialSize } from "@/lib/social-sizes";
import type { TemplateKey } from "@/server/social/templates";

/**
 * Plan 54 Wave 2B — `<TemplateConfigClient>` orchestrates the size picker
 * + preview iframe + download button into a single workflow surface.
 *
 * Owns the selected `size` state because it has to flow into both the
 * iframe src AND the download action. Initial size comes from the
 * server (template's first supported size) so the URL is deterministic
 * across SSR + first paint.
 *
 * Spec: docs/superpowers/specs/2026-05-05-broadcast-social-media.md §6.
 */

export function TemplateConfigClient({
  templateKey,
  supportedSizes,
  initialSize,
  sessionId,
}: {
  templateKey: TemplateKey;
  supportedSizes: ReadonlyArray<SocialSize>;
  initialSize: SocialSize;
  sessionId: string | null;
}) {
  const [size, setSize] = useState<SocialSize>(initialSize);

  return (
    <div className="space-y-6" data-testid="template-config-client">
      <div className="space-y-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          Size
        </h2>
        <SizePicker sizes={supportedSizes} value={size} onChange={setSize} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <PreviewIframe
          templateKey={templateKey}
          size={size}
          sessionId={sessionId}
        />
        <div className="space-y-4">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Render
          </h2>
          <DownloadButton
            templateKey={templateKey}
            size={size}
            sessionId={sessionId}
          />
        </div>
      </div>
    </div>
  );
}
