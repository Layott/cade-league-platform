"use client";

import { useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { ZodType } from "zod";
import { usePreviewMode } from "@/lib/overlay-preview";
import { useOverlayChannel } from "../useOverlayChannel";
import { OverlayFrame, getDebugFlag } from "../OverlayFrame";
import type { TemplateKey } from "@/server/overlays/registry";

/**
 * Plan 16 — shared stub scaffold for every new overlay template route.
 *
 * Each production page delegates to this wrapper. In preview mode
 * (`?preview=1`) the payload is read from the URL query; otherwise the
 * realtime channel supplies it. Callers render their template-specific
 * visual inside the `render` prop.
 *
 * The stub wraps every overlay in `<OverlayFrame>`, adds a debug HUD
 * when `NEXT_PUBLIC_OVERLAY_DEBUG=1`, and exposes the preview cycle
 * counter so animated templates can re-key themselves per cycle.
 */
export type PreviewStubProps<T> = {
  templateKey: TemplateKey;
  schema: ZodType<T>;
  position?: "bottom-left" | "bottom-center" | "top-right" | "center";
  render: (payload: T, ctx: { cycle: number; preview: boolean }) => React.ReactNode;
};

export function PreviewStub<T>(props: PreviewStubProps<T>) {
  return (
    <Suspense fallback={null}>
      <Inner {...props} />
    </Suspense>
  );
}

function Inner<T>({
  templateKey,
  schema,
  position = "center",
  render,
}: PreviewStubProps<T>) {
  const sp = useSearchParams();
  const sessionId = sp?.get("session") ?? null;
  const preview = usePreviewMode();
  const channel = useOverlayChannel(sessionId, templateKey);

  const activePayload = preview.enabled ? preview.payload : channel.payload;
  const parsed = useMemo(() => {
    if (activePayload == null) return null;
    return schema.safeParse(activePayload);
  }, [activePayload, schema]);

  // In preview mode we force-show the card (no real session) by
  // synthesising an OverlayState whose `payload` is non-null so
  // OverlayFrame fades in.
  const syntheticState = preview.enabled
    ? {
        ...channel,
        connected: true,
        payload:
          parsed && parsed.success
            ? (parsed.data as unknown as Record<string, unknown>)
            : null,
        eventId: `preview-${preview.cycle}`,
        lastEventAt: Date.now(),
      }
    : channel;

  return (
    <OverlayFrame
      state={syntheticState}
      debug={getDebugFlag() || preview.enabled}
      position={position}
    >
      <div data-template-slot={templateKey}>
        {parsed && parsed.success
          ? render(parsed.data as T, {
              cycle: preview.cycle,
              preview: preview.enabled,
            })
          : null}
      </div>
    </OverlayFrame>
  );
}
