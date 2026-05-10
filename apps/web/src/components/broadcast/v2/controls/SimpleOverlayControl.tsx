"use client";

import { useCallback, useRef } from "react";
import { ControlCard, postToFrame } from "../ControlCard";
import { ReTriggerHideButtons } from "../ReTriggerHideButtons";
import type { V2OverlayKey } from "../overlay-keys";
import { getCoverUpPayload } from "../template-mapping";

export type SimpleOverlayControlProps = {
  overlayKey: V2OverlayKey;
  sessionId: string;
  viewToken: string | null;
  active?: boolean;
  /**
   * Optional JSON-stringified payload sent on trigger. When omitted, the
   * per-overlay minimum-viable payload from `getCoverUpPayload(overlayKey)`
   * is used so the trigger satisfies the mapped legacy Zod schema. The
   * cover-up overlays (21..29) carry no runtime data — the HTML itself
   * holds the content — but the legacy schemas still require certain
   * fields (e.g. `topN`, `matchDayLabel`, `org.name`).
   */
  payload?: string;
};

/**
 * Generic Trigger + Hide overlay control. Used by the cover-up overlays
 * (21..29) which all share the same trigger/clear contract — postMessage
 * `show` on enter, `hide` on exit, no payload edits exposed in the
 * control card. Each overlay's static HTML carries its own content; the
 * control just drives visibility through a side-by-side Trigger/Hide
 * pair (mirrors the editable controls' UX) so producers can re-fire
 * after editing copy via the design panel without first toggling OFF.
 */
export function SimpleOverlayControl({
  overlayKey,
  sessionId,
  viewToken,
  active = false,
  payload,
}: SimpleOverlayControlProps) {
  const resolvedPayload = payload ?? getCoverUpPayload(overlayKey);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const onIframeReady = useCallback((el: HTMLIFrameElement | null) => {
    iframeRef.current = el;
  }, []);

  const onOptimisticTrigger = useCallback(() => {
    postToFrame(iframeRef.current, { type: "show", data: {} });
  }, []);

  const onOptimisticHide = useCallback(() => {
    postToFrame(iframeRef.current, { type: "hide" });
  }, []);

  return (
    <ControlCard
      overlayKey={overlayKey}
      sessionId={sessionId}
      viewToken={viewToken}
      onIframeReady={onIframeReady}
      active={active}
      liveBadge={active}
      triggerSlot={
        <ReTriggerHideButtons
          overlayKey={overlayKey}
          sessionId={sessionId}
          active={active}
          onOptimisticTrigger={onOptimisticTrigger}
          onOptimisticHide={onOptimisticHide}
          payloadFields={
            <input type="hidden" name="payload" value={resolvedPayload} />
          }
        />
      }
    />
  );
}
