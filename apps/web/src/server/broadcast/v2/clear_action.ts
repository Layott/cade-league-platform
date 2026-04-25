/**
 * Plan 51 — broadcast v2 clear-action FormData builders.
 *
 * Wraps the FormData shape expected by the existing server actions
 * `clearOverlayAction`, `clearInstanceAction`, `clearScoreBugAction`. The
 * pure builders here let the v2 control panel + the overlay routes
 * construct identical FormData payloads without each duplicating the
 * field list.
 *
 * Field schemas (kept in sync with `apps/web/src/app/admin/broadcast/
 * actions.ts`):
 *
 *   clearOverlayAction:    sessionId, eventId
 *   clearInstanceAction:   sessionId, instanceId
 *   clearScoreBugAction:   sessionId, slot ('primary' | 'secondary')
 *
 * The signatures here mirror the FormData input — server actions accept
 * `FormData` and `String(formData.get(...))`-coerce. Callers can either
 * pass these into a `<form>` action or POST as multipart.
 */

import {
  offActionCategory,
  type OffActionCategory,
  type OffButtonGateInput,
  offButtonCanFire,
} from "./off_routing";

export type ClearOverlayInput = {
  sessionId: string;
  eventId: string;
};

export type ClearInstanceInput = {
  sessionId: string;
  instanceId: string;
};

export type ClearScoreBugInput = {
  sessionId: string;
  slot: "primary" | "secondary";
};

/**
 * Build the FormData payload for `clearOverlayAction`.
 */
export function buildClearOverlayFormData(
  input: ClearOverlayInput,
): FormData {
  if (!input.sessionId) throw new Error("sessionId is required");
  if (!input.eventId) throw new Error("eventId is required");
  const fd = new FormData();
  fd.set("sessionId", input.sessionId);
  fd.set("eventId", input.eventId);
  return fd;
}

/**
 * Build the FormData payload for `clearInstanceAction`.
 */
export function buildClearInstanceFormData(
  input: ClearInstanceInput,
): FormData {
  if (!input.sessionId) throw new Error("sessionId is required");
  if (!input.instanceId) throw new Error("instanceId is required");
  const fd = new FormData();
  fd.set("sessionId", input.sessionId);
  fd.set("instanceId", input.instanceId);
  return fd;
}

/**
 * Build the FormData payload for `clearScoreBugAction`.
 */
export function buildClearScoreBugFormData(
  input: ClearScoreBugInput,
): FormData {
  if (!input.sessionId) throw new Error("sessionId is required");
  if (input.slot !== "primary" && input.slot !== "secondary") {
    throw new Error("slot must be 'primary' or 'secondary'");
  }
  const fd = new FormData();
  fd.set("sessionId", input.sessionId);
  fd.set("slot", input.slot);
  return fd;
}

export type ResolvedClearAction =
  | { category: "score_bug"; formData: FormData; canFire: boolean }
  | { category: "instance"; formData: FormData; canFire: boolean }
  | { category: "single_event"; formData: FormData; canFire: boolean };

/**
 * One-stop resolver: route the templateKey to its clear action category +
 * build the right FormData + compute whether the button can fire. The
 * v2 control panel uses this to render the OFF form.
 */
export function resolveClearAction(args: {
  templateKey: string;
  sessionId: string;
  /** for single_event */
  latestEventId?: string | null;
  /** for instance */
  instanceId?: string | null;
  /** for score_bug */
  slot?: "primary" | "secondary";
  /** caller-forced disable (perm gating) */
  disabled?: boolean;
}): ResolvedClearAction {
  const category = offActionCategory(args.templateKey);
  const gateInput: OffButtonGateInput = {
    category,
    latestEventId: args.latestEventId ?? null,
    instanceId: args.instanceId ?? null,
    disabled: args.disabled,
  };
  const canFire = offButtonCanFire(gateInput);

  // When the button cannot fire, build a "skeleton" FormData with empty
  // hidden fields so the form still renders -- the form is server-action
  // bound, and the disabled flag prevents submission. This matches the
  // legacy OffTriggerButton behaviour (renders disabled form when no id).
  switch (category) {
    case "score_bug": {
      const fd = new FormData();
      fd.set("sessionId", args.sessionId);
      fd.set("slot", args.slot ?? "primary");
      return { category, canFire, formData: fd };
    }
    case "instance": {
      const fd = new FormData();
      fd.set("sessionId", args.sessionId);
      fd.set("instanceId", args.instanceId ?? "");
      return { category, canFire, formData: fd };
    }
    case "single_event": {
      const fd = new FormData();
      fd.set("sessionId", args.sessionId);
      fd.set("eventId", args.latestEventId ?? "");
      return { category, canFire, formData: fd };
    }
  }
}

export type { OffActionCategory };
