"use client";

import { DangerButton } from "@/components/admin/buttons";
import {
  clearOverlayAction,
  clearInstanceAction,
  clearScoreBugAction,
} from "@/app/admin/broadcast/actions";

/**
 * Plan 48 — universal Trigger-OFF button mounted next to every template's
 * primary trigger. Dispatches to the correct clear-* server action based
 * on template type:
 *
 *   score_bug                                  → clearScoreBugAction
 *   lower_third | up_next_bug | layout_timer   → clearInstanceAction
 *   everything else                            → clearOverlayAction
 *
 * Single-instance templates need the latest active event id (prop
 * `latestEventId`); multi-instance templates need `instanceId` from the
 * `active_instances` row for that slot. When no live instance exists the
 * button renders disabled.
 */

export type OffTriggerButtonProps = {
  templateKey: string;
  sessionId: string;
  /** For single-instance event-based templates. */
  latestEventId?: string | null;
  /** For multi-instance templates (lower_third, up_next_bug, layout_timer). */
  instanceId?: string | null;
  /** For score_bug, required to tell primary vs secondary. */
  slot?: "primary" | "secondary";
  disabled?: boolean;
  "data-testid"?: string;
  size?: "sm" | "md";
};

const MULTI_INSTANCE_KEYS = new Set<string>([
  "lower_third",
  "up_next_bug",
  "layout_timer",
]);

export function OffTriggerButton(props: OffTriggerButtonProps) {
  const {
    templateKey,
    sessionId,
    latestEventId,
    instanceId,
    slot,
    disabled: disabledProp,
    "data-testid": testId,
    size = "sm",
  } = props;

  // score_bug — uses its own clearScoreBugAction (Plan 45). Needs slot only.
  if (templateKey === "score_bug") {
    return (
      <form action={clearScoreBugAction}>
        <input type="hidden" name="sessionId" value={sessionId} />
        <input
          type="hidden"
          name="slot"
          value={slot ?? "primary"}
        />
        <DangerButton
          type="submit"
          size={size}
          disabled={disabledProp}
          data-testid={testId ?? `off-${templateKey}`}
        >
          Trigger OFF
        </DangerButton>
      </form>
    );
  }

  // Multi-instance — needs an instanceId. If none, render disabled.
  if (MULTI_INSTANCE_KEYS.has(templateKey)) {
    const canFire = !!instanceId && !disabledProp;
    return (
      <form action={clearInstanceAction}>
        <input type="hidden" name="sessionId" value={sessionId} />
        <input type="hidden" name="instanceId" value={instanceId ?? ""} />
        <DangerButton
          type="submit"
          size={size}
          disabled={!canFire}
          data-testid={testId ?? `off-${templateKey}`}
        >
          Trigger OFF
        </DangerButton>
      </form>
    );
  }

  // Everything else — single-instance overlay_events. Needs latestEventId.
  const canFire = !!latestEventId && !disabledProp;
  return (
    <form action={clearOverlayAction}>
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="eventId" value={latestEventId ?? ""} />
      <DangerButton
        type="submit"
        size={size}
        disabled={!canFire}
        data-testid={testId ?? `off-${templateKey}`}
      >
        Trigger OFF
      </DangerButton>
    </form>
  );
}
