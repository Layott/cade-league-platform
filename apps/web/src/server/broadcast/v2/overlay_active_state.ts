import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveForTemplate } from "@/server/broadcast/events";
import { listActiveInstances } from "@/server/overlays/instances";
import { isMultiInstance } from "./off_routing";
import {
  V2_OVERLAY_KEYS,
  type V2OverlayKey,
} from "@/components/broadcast/v2/overlay-keys";
import { v2ToLegacy } from "@/components/broadcast/v2/template-mapping";

/**
 * Plan 51 — toggle button state probe.
 *
 * Each v2 control card now renders a single toggle button instead of the
 * old ENTER + OUT pair. The toggle's label / color depend on whether the
 * overlay is currently active. This module returns the per-overlay-key
 * boolean state so the page can pass it to the grid at render time.
 *
 * Single-instance keys read from `overlay_events` via `getActiveForTemplate`.
 * The only multi-instance key (`08-lower-third`) returns three booleans
 * keyed by slot 1..3 from `overlay_active_instances`.
 */

export type V2ActiveStateMap = {
  /** key -> active flag for single-instance overlays */
  single: Record<string, boolean>;
  /** key -> [slot1, slot2, slot3] for multi-instance overlays */
  multi: Record<string, [boolean, boolean, boolean]>;
};

/**
 * Probe the active state of a single-instance overlay key.
 */
export async function isOverlayActive(
  sb: SupabaseClient,
  sessionId: string,
  v2Key: V2OverlayKey,
): Promise<boolean> {
  const legacyKey = v2ToLegacy(v2Key);
  if (isMultiInstance(legacyKey)) {
    // Multi-instance overlays should be queried per-slot via
    // `isInstanceActive`; treat "any slot active" as active here.
    const list = await listActiveInstances(sb, sessionId, legacyKey);
    return list.length > 0;
  }
  const row = await getActiveForTemplate(sb, sessionId, legacyKey);
  return Boolean(row);
}

/**
 * Probe the active state of a specific multi-instance slot.
 */
export async function isInstanceActive(
  sb: SupabaseClient,
  sessionId: string,
  v2Key: V2OverlayKey,
  slot: 1 | 2 | 3,
): Promise<boolean> {
  const legacyKey = v2ToLegacy(v2Key);
  if (!isMultiInstance(legacyKey)) {
    // For non-multi keys, slot is meaningless — return the single-instance
    // flag. Lets callers safely pass a slot without branching.
    return isOverlayActive(sb, sessionId, v2Key);
  }
  const list = await listActiveInstances(sb, sessionId, legacyKey);
  return list.some((row) => row.instanceSlot === slot);
}

/**
 * Probe the active state for every v2 overlay key + every lower-third slot
 * in a single fan-out. Returns a map structured for direct consumption by
 * the ControlGrid client component.
 */
export async function probeAllActiveStates(
  sb: SupabaseClient,
  sessionId: string,
): Promise<V2ActiveStateMap> {
  const single: Record<string, boolean> = {};
  const multi: Record<string, [boolean, boolean, boolean]> = {};

  await Promise.all(
    V2_OVERLAY_KEYS.map(async (key) => {
      const legacyKey = v2ToLegacy(key);
      if (isMultiInstance(legacyKey)) {
        const list = await listActiveInstances(sb, sessionId, legacyKey);
        const slots: [boolean, boolean, boolean] = [false, false, false];
        for (const row of list) {
          if (row.instanceSlot >= 1 && row.instanceSlot <= 3) {
            slots[row.instanceSlot - 1] = true;
          }
        }
        multi[key] = slots;
        // Mirror "any slot" into single map so callers that only look at
        // `single` still see correct state for the card-level label.
        single[key] = slots.some(Boolean);
      } else {
        const row = await getActiveForTemplate(sb, sessionId, legacyKey);
        single[key] = Boolean(row);
      }
    }),
  );

  return { single, multi };
}
