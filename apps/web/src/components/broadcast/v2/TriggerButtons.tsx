"use client";

import type { ReactNode } from "react";
import { PrimaryButton, DangerButton } from "@/components/admin/buttons";
import {
  triggerOverlayEnterAction,
  triggerOverlayOffAction,
} from "@/app/admin/broadcast/v2/[sessionId]/actions";
import type { V2OverlayKey } from "./overlay-keys";

/**
 * Plan 51 — ENTER + OUT trigger row used by every ControlCard.
 *
 * Each control bakes the per-overlay payload into a hidden field on the
 * ENTER form (passed via the `payloadFields` ReactNode slot). The OUT
 * form clears the latest active row for the overlay key. Both forms post
 * to server actions that gate `broadcast.v2.trigger`.
 */
export type TriggerEnterFormProps = {
  overlayKey: V2OverlayKey;
  sessionId: string;
  /**
   * Hidden inputs that carry the payload (a JSON string) + any
   * instanceSlot needed for multi-instance overlays. The control fills
   * these from its inline editor state.
   */
  payloadFields: ReactNode;
  /** ENTER button label (defaults to "Trigger ENTER"). */
  enterLabel?: string;
  /** When false, the ENTER button is disabled (e.g. session ended). */
  canEnter?: boolean;
  /** Test-id suffix; defaults to overlayKey. */
  testIdSuffix?: string;
};

export function TriggerEnterForm({
  overlayKey,
  sessionId,
  payloadFields,
  enterLabel = "Trigger ENTER",
  canEnter = true,
  testIdSuffix,
}: TriggerEnterFormProps) {
  const id = testIdSuffix ?? overlayKey;
  return (
    <form
      action={triggerOverlayEnterAction}
      className="flex w-full"
      data-testid={`v2-enter-form-${id}`}
    >
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="overlayKey" value={overlayKey} />
      {payloadFields}
      <PrimaryButton
        type="submit"
        size="sm"
        disabled={!canEnter}
        data-testid={`v2-enter-btn-${id}`}
        className="w-full"
      >
        {enterLabel}
      </PrimaryButton>
    </form>
  );
}

export type TriggerOffFormProps = {
  overlayKey: V2OverlayKey;
  sessionId: string;
  /** For multi-instance overlays — slot 1..3. Undefined for single-instance. */
  instanceSlot?: number;
  testIdSuffix?: string;
  disabled?: boolean;
};

export function TriggerOffForm({
  overlayKey,
  sessionId,
  instanceSlot,
  testIdSuffix,
  disabled,
}: TriggerOffFormProps) {
  const id = testIdSuffix ?? overlayKey;
  return (
    <form
      action={triggerOverlayOffAction}
      data-testid={`v2-off-form-${id}`}
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
      <DangerButton
        type="submit"
        size="sm"
        data-testid={`v2-off-btn-${id}`}
        disabled={disabled}
      >
        Trigger OUT
      </DangerButton>
    </form>
  );
}
