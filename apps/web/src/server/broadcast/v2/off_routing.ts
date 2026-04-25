/**
 * Plan 51 — broadcast v2 OFF-trigger routing.
 *
 * Extracted from `apps/web/src/components/broadcast/OffTriggerButton.tsx`
 * (Plan 48.4 routing fix). One template_key in -> one of three OFF action
 * categories out:
 *
 *   - score_bug   -> "score_bug"        (clearScoreBugAction)
 *   - lower_third -> "instance"         (clearInstanceAction)
 *   - everything  -> "single_event"     (clearOverlayAction)
 *
 * The Plan 48.4 lesson: only `lower_third` writes to
 * `overlay_active_instances`. `up_next_bug` + `layout_timer` triggered
 * via `triggerOverlayAction` -> `overlay_events`, so their OFF must hit
 * `clearOverlayAction`. Earlier code had them in the multi-instance set
 * which produced "no active instance" -> disabled OFF buttons.
 *
 * Pure logic module — no React, no Supabase. Both broadcast v2 control
 * panel + overlay routes import these helpers.
 */

export const SCORE_BUG_KEY = "score_bug" as const;

/**
 * The ONLY template that writes into `overlay_active_instances`. Adding
 * other keys here is a regression — see Plan 48.4 fix for context.
 */
export const MULTI_INSTANCE_KEYS: ReadonlySet<string> = new Set<string>([
  "lower_third",
]);

export type OffActionCategory = "score_bug" | "instance" | "single_event";

/**
 * Decide which clear-* server action a given template_key should route to.
 */
export function offActionCategory(templateKey: string): OffActionCategory {
  if (templateKey === SCORE_BUG_KEY) return "score_bug";
  if (MULTI_INSTANCE_KEYS.has(templateKey)) return "instance";
  return "single_event";
}

/**
 * Convenience predicate — true if a template uses `overlay_active_instances`.
 */
export function isMultiInstance(templateKey: string): boolean {
  return MULTI_INSTANCE_KEYS.has(templateKey);
}

export type OffButtonGateInput = {
  category: OffActionCategory;
  /** Required for single-instance OFF (overlay_events). */
  latestEventId?: string | null;
  /** Required for multi-instance OFF (overlay_active_instances). */
  instanceId?: string | null;
  /** Caller-provided forced disable (e.g. perm-gated). */
  disabled?: boolean;
};

/**
 * Compute whether the OFF button should be enabled. Returns false when
 * the required identifier for the action is missing OR the caller forced
 * `disabled=true`.
 */
export function offButtonCanFire(input: OffButtonGateInput): boolean {
  if (input.disabled) return false;
  switch (input.category) {
    case "score_bug":
      // score_bug always has a valid slot; nothing else to check.
      return true;
    case "instance":
      return Boolean(input.instanceId);
    case "single_event":
      return Boolean(input.latestEventId);
  }
}
