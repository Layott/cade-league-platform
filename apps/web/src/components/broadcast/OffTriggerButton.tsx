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
 *   score_bug     → clearScoreBugAction  (match-flow, per-slot)
 *   lower_third   → clearInstanceAction  (overlay_active_instances)
 *   everything else → clearOverlayAction (overlay_events — single instance)
 *
 * Plan 48.4 (2026-04-24) — routing correction. Earlier build wrongly
 * categorised `up_next_bug` + `layout_timer` as multi-instance: they
 * both trigger via `triggerOverlayAction` into `overlay_events`, so
 * dispatching their OFF to `clearInstanceAction` (which scans
 * `overlay_active_instances`) always produced "no active instance" →
 * disabled button. Routed them through `clearOverlayAction` so OFF
 * clears the right row + publishes `overlay.cleared`. Only true multi-
 * instance template is `lower_third`.
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

// Plan 48.4 — only `lower_third` uses the `overlay_active_instances`
// (multi-slot) table. Every other editable-template overlay writes into
// `overlay_events` via `triggerOverlayAction`, so their OFF must go
// through `clearOverlayAction` to hit the right row.
const MULTI_INSTANCE_KEYS = new Set<string>([
  "lower_third",
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
