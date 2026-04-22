"use client";

import { useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { ZodType } from "zod";
import { usePreviewMode } from "@/lib/overlay-preview";
import { useOverlayChannel } from "../useOverlayChannel";
import { OverlayFrame, getDebugFlag, type OverlayPosition } from "../OverlayFrame";
import type { TemplateKey } from "@/server/overlays/registry";

/**
 * Plan 16 — shared stub scaffold for every new overlay template route.
 *
 * Each production page delegates to this wrapper. In preview mode
 * (`?preview=1`) the payload is read from the URL query; otherwise the
 * realtime channel supplies it. Callers render their template-specific
 * visual inside the `render` prop.
 *
 * Every render is keyed by the cycle counter so preview mode re-runs the
 * AnimatePresence enter/exit every 8s. Production mode re-runs on each
 * new `eventId` from the realtime channel.
 */
export type PreviewStubProps<T> = {
  templateKey: TemplateKey;
  schema: ZodType<T>;
  position?: OverlayPosition;
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
  // Plan 42.1 — URL `?slot=primary|secondary` routes match-aware overlays
  // to the corresponding match slot. Default undefined so non-match-aware
  // templates (scorebar, standings, intro, etc.) bypass slot filtering.
  const slotRaw = sp?.get("slot") ?? null;
  const slot: "primary" | "secondary" | undefined =
    slotRaw === "primary" || slotRaw === "secondary" ? slotRaw : undefined;
  const preview = usePreviewMode();
  const channel = useOverlayChannel(sessionId, templateKey, slot);

  const activePayload = preview.enabled ? preview.payload : channel.payload;
  const parsed = useMemo(() => {
    if (activePayload == null) return null;
    return schema.safeParse(activePayload);
  }, [activePayload, schema]);

  // In preview mode, synthesize an OverlayState with a per-cycle eventId
  // so AnimatePresence can restage enter/exit on each loop.
  const syntheticState = preview.enabled
    ? {
        ...channel,
        connected: true,
        payload:
          parsed && parsed.success
            ? (parsed.data as unknown as Record<string, unknown>)
            : null,
        eventId: `preview-${templateKey}-${preview.cycle}`,
        lastEventAt: Date.now(),
      }
    : channel;

  const motionKey = preview.enabled
    ? `preview-${preview.cycle}`
    : channel.eventId ?? "static";

  return (
    <OverlayFrame
      state={syntheticState}
      debug={getDebugFlag() || preview.enabled}
      position={position}
      motionKey={motionKey}
    >
      <div
        data-template-slot={templateKey}
        style={{ width: "100%", height: "100%" }}
      >
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
