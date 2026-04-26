"use client";

import type { ReactNode } from "react";
import { PrimaryButton, DangerButton } from "@/components/admin/buttons";
import { toggleOverlayAction } from "@/app/admin/broadcast/v2/[sessionId]/actions";
import type { V2OverlayKey } from "./overlay-keys";

/**
 * Plan 51 — single toggle button replacing the ENTER + OUT pair.
 *
 * When `active=false` the button renders green ("Trigger ON"). When the
 * overlay is currently active it flips to pink ("Trigger OFF"). The form
 * always posts to `toggleOverlayAction`, which probes the current state
 * server-side and routes to triggerOverlay / clearOverlay accordingly —
 * the `active` prop here only drives the UI label, not the server logic.
 *
 * Optimistic UX: `onOptimisticToggle` fires SYNCHRONOUSLY on click
 * BEFORE the server-action submit. Receives `nextActive` so the parent
 * control can postMessage `show` or `hide` into its sibling preview
 * iframe for instant UX (<50ms) instead of waiting for the realtime
 * round-trip (300-800ms). Server action still runs in parallel for OBS
 * overlays + persistence + audit. The callback is wrapped in try/catch
 * so a postMessage failure can never block the form submit.
 */
export type ToggleTriggerButtonProps = {
  overlayKey: V2OverlayKey;
  sessionId: string;
  active: boolean;
  /** For multi-instance overlays — slot 1..3. Undefined for single-instance. */
  instanceSlot?: number;
  /**
   * Hidden inputs that carry the trigger payload. Ignored when the overlay
   * is currently active (the server-side toggle skips payload parsing on
   * the OFF branch), but always rendered so the form stays uniform.
   */
  payloadFields?: ReactNode;
  /** When false, the button is disabled (e.g. session ended, no upcoming). */
  canEnter?: boolean;
  /** Override label — defaults to "Trigger ON" / "Trigger OFF". */
  onLabel?: string;
  offLabel?: string;
  /** Test-id suffix; defaults to overlayKey. */
  testIdSuffix?: string;
  /** Optional submit handler (e.g. TimerControl recomputes expiresAt). */
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  className?: string;
  /** Test ID override for the submit button itself. */
  buttonTestId?: string;
  /**
   * Optimistic callback fired synchronously on click BEFORE the server-
   * action submit. Receives the next active state the toggle is about
   * to flip to. Must NEVER throw.
   */
  onOptimisticToggle?: (nextActive: boolean) => void;
};

export function ToggleTriggerButton({
  overlayKey,
  sessionId,
  active,
  instanceSlot,
  payloadFields,
  canEnter = true,
  onLabel = "Trigger ON",
  offLabel = "Trigger OFF",
  testIdSuffix,
  onSubmit,
  className = "",
  buttonTestId,
  onOptimisticToggle,
}: ToggleTriggerButtonProps) {
  const id = testIdSuffix ?? overlayKey;
  const slotSuffix = typeof instanceSlot === "number" ? `-${instanceSlot}` : "";
  const Btn = active ? DangerButton : PrimaryButton;
  const label = active ? offLabel : onLabel;
  const btnId = buttonTestId ?? `v2-toggle-btn-${id}${slotSuffix}`;

  // Wrap optimistic toggle in try/catch so a postMessage failure can
  // never block the server-action form submit.
  const handleOptimistic = () => {
    if (!onOptimisticToggle) return;
    try {
      onOptimisticToggle(!active);
    } catch {
      /* swallow — never block submit */
    }
  };

  return (
    <form
      action={toggleOverlayAction}
      onSubmit={onSubmit}
      className={`flex w-full ${className}`}
      data-testid={`v2-toggle-form-${id}${slotSuffix}`}
      data-active={active ? "true" : "false"}
    >
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="overlayKey" value={overlayKey} />
      {typeof instanceSlot === "number" ? (
        <input
          type="hidden"
          name="instanceSlot"
          value={String(instanceSlot)}
        />
      ) : null}
      {payloadFields}
      <Btn
        type="submit"
        size="sm"
        disabled={!active && !canEnter}
        data-testid={btnId}
        className="w-full"
        onClick={handleOptimistic}
      >
        {label}
      </Btn>
    </form>
  );
}
