"use client";

import type { ReactNode } from "react";
import { PrimaryButton, DangerButton } from "@/components/admin/buttons";
import {
  retriggerOverlayAction,
  triggerOverlayOffAction,
} from "@/app/admin/broadcast/v2/[sessionId]/actions";
import type { V2OverlayKey } from "./overlay-keys";

/**
 * EDITABLE-control footer — Trigger + Hide pair.
 *
 * Used by overlays whose payload depends on inline field state (timer,
 * h2h, lower-third, score-bug, up-next, match-scores-day). The "Trigger"
 * button ALWAYS re-fires the current payload (clear-then-trigger), so
 * re-clicking after editing a field replays the entry animation with
 * fresh values rather than toggling OFF. The "Hide" button calls the
 * existing OFF action to clear without re-firing.
 *
 * The active state is surfaced to operators via a "Live" badge in the
 * card header (rendered by the parent control), not by morphing the
 * Trigger button label or color — that would re-introduce the same
 * confusion the toggle pattern caused.
 *
 * Optimistic UX: each button accepts an `onOptimistic*` callback fired
 * SYNCHRONOUSLY on click (before the server-action form submit). Lets
 * the parent control postMessage into its sibling preview iframe so the
 * UI reacts in <50ms instead of waiting 300-800ms for the realtime
 * round-trip. Server action still runs in parallel for OBS overlays +
 * persistence + audit. Callbacks are wrapped in try/catch so a
 * postMessage failure can never block the form submit.
 */
export type ReTriggerHideButtonsProps = {
  overlayKey: V2OverlayKey;
  sessionId: string;
  /** Per-overlay active flag — drives only the Hide button's enabled state. */
  active: boolean;
  /** For multi-instance overlays — slot 1..3. Undefined for single-instance. */
  instanceSlot?: number;
  /**
   * Hidden inputs that carry the trigger payload. Must include a
   * `<input name="payload">` field (controls bake JSON into it).
   */
  payloadFields: ReactNode;
  /** When false, the Trigger button is disabled (e.g. session ended). */
  canTrigger?: boolean;
  /** Override label — defaults to "Trigger" / "Hide". */
  triggerLabel?: string;
  hideLabel?: string;
  /** Test-id suffix; defaults to overlayKey. */
  testIdSuffix?: string;
  /** Optional submit handler on the trigger form (e.g. timer recompute). */
  onTriggerSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  className?: string;
  /** Test ID overrides for buttons. */
  triggerButtonTestId?: string;
  hideButtonTestId?: string;
  /**
   * Optimistic callbacks — fired SYNCHRONOUSLY on click BEFORE the
   * server-action form submit. Must NEVER throw or the form submit
   * could be blocked.
   */
  onOptimisticTrigger?: () => void;
  onOptimisticHide?: () => void;
};

export function ReTriggerHideButtons({
  overlayKey,
  sessionId,
  active,
  instanceSlot,
  payloadFields,
  canTrigger = true,
  triggerLabel = "Trigger",
  hideLabel = "Hide",
  testIdSuffix,
  onTriggerSubmit,
  className = "",
  triggerButtonTestId,
  hideButtonTestId,
  onOptimisticTrigger,
  onOptimisticHide,
}: ReTriggerHideButtonsProps) {
  const id = testIdSuffix ?? overlayKey;
  const slotSuffix = typeof instanceSlot === "number" ? `-${instanceSlot}` : "";
  const triggerBtnId =
    triggerButtonTestId ?? `v2-retrigger-btn-${id}${slotSuffix}`;
  const hideBtnId = hideButtonTestId ?? `v2-hide-btn-${id}${slotSuffix}`;

  const slotInput =
    typeof instanceSlot === "number" ? (
      <input
        type="hidden"
        name="instanceSlot"
        value={String(instanceSlot)}
      />
    ) : null;

  // Wrap optimistic callbacks in try/catch so a postMessage failure can
  // never block the server-action form submit.
  const handleOptimisticTrigger = () => {
    if (!onOptimisticTrigger) return;
    try {
      onOptimisticTrigger();
    } catch {
      /* swallow — never block submit */
    }
  };

  const handleOptimisticHide = () => {
    if (!onOptimisticHide) return;
    try {
      onOptimisticHide();
    } catch {
      /* swallow — never block submit */
    }
  };

  return (
    <div
      className={`flex w-full gap-2 ${className}`}
      data-testid={`v2-retrigger-row-${id}${slotSuffix}`}
      data-active={active ? "true" : "false"}
    >
      {/* Trigger — always re-fires fresh payload */}
      <form
        action={retriggerOverlayAction}
        onSubmit={onTriggerSubmit}
        className="flex-1"
        data-testid={`v2-retrigger-form-${id}${slotSuffix}`}
      >
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="overlayKey" value={overlayKey} />
        {slotInput}
        {payloadFields}
        <PrimaryButton
          type="submit"
          size="sm"
          disabled={!canTrigger}
          data-testid={triggerBtnId}
          className="w-full"
          onClick={handleOptimisticTrigger}
        >
          {triggerLabel}
        </PrimaryButton>
      </form>

      {/* Hide — clears the active row without re-triggering */}
      <form
        action={triggerOverlayOffAction}
        className="flex-1"
        data-testid={`v2-hide-form-${id}${slotSuffix}`}
      >
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="overlayKey" value={overlayKey} />
        {slotInput}
        <DangerButton
          type="submit"
          size="sm"
          disabled={!active}
          data-testid={hideBtnId}
          className="w-full"
          onClick={handleOptimisticHide}
        >
          {hideLabel}
        </DangerButton>
      </form>
    </div>
  );
}
