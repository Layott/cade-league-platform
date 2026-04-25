"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import {
  triggerOverlay,
  clearOverlay,
  getActiveForTemplate,
} from "@/server/broadcast/events";
import {
  triggerInstance,
  clearInstance,
  listActiveInstances,
} from "@/server/overlays/instances";
import { isMultiInstance } from "@/server/broadcast/v2/off_routing";
import {
  V2_OVERLAY_KEYS,
  type V2OverlayKey,
} from "@/components/broadcast/v2/overlay-keys";
import { v2ToLegacy } from "@/components/broadcast/v2/template-mapping";
import type { TemplateKey } from "@/server/overlays/registry";

/**
 * Plan 51 — broadcast v2 control panel server actions.
 *
 * Two perms control entry: `broadcast.v2.read` for the page (gated in
 * the layout) and `broadcast.v2.trigger` for ENTER + OUT. Each ENTER
 * routes through existing `triggerOverlay` (or `triggerInstance` when
 * the overlay key is multi-instance per off_routing.ts). Each OUT
 * routes through `clearOverlay` / `clearInstance`. The realtime publish
 * is performed inside those server modules so v2 + legacy share a
 * single notification path.
 */

async function resolveAuthed(): Promise<{
  publicUserId: string;
  roles: readonly string[];
}> {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login");
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  return { publicUserId: pub.id, roles };
}

async function gateTrigger(): Promise<{
  sb: ReturnType<typeof getServiceRoleSupabase>;
  publicUserId: string;
}> {
  const { publicUserId, roles } = await resolveAuthed();
  const sb = getServiceRoleSupabase();
  try {
    await requirePermAsync(
      sb,
      { userId: publicUserId, roles },
      "broadcast.v2.trigger",
    );
  } catch (e) {
    if (e instanceof PermissionError) {
      throw new Error("Forbidden: missing broadcast.v2.trigger");
    }
    throw e;
  }
  return { sb, publicUserId };
}

function isV2Key(x: string): x is V2OverlayKey {
  return (V2_OVERLAY_KEYS as readonly string[]).includes(x);
}

function parsePayload(raw: string): Record<string, unknown> {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || trimmed === "undefined") return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== "object") return {};
    return parsed as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown parse error";
    throw new Error(`payload must be valid JSON — ${msg}`);
  }
}

/**
 * ENTER trigger — routes to the right table for the v2 overlay key.
 *
 * `08-lower-third` is the only multi-instance key (3 simultaneous slots);
 * everything else writes a single overlay_events row (one active per
 * key). Slot 1..3 only honored when multi-instance.
 */
export async function triggerOverlayEnterAction(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  const overlayKey = String(formData.get("overlayKey") ?? "");
  const payloadRaw = String(formData.get("payload") ?? "{}");
  const slotRaw = String(formData.get("instanceSlot") ?? "");

  if (!sessionId) throw new Error("sessionId required");
  if (!isV2Key(overlayKey)) {
    throw new Error(`unknown v2 overlay key: ${overlayKey}`);
  }

  const legacyKey: TemplateKey = v2ToLegacy(overlayKey);
  const payload = parsePayload(payloadRaw);

  const { sb, publicUserId } = await gateTrigger();

  if (isMultiInstance(legacyKey)) {
    const slot = slotRaw ? Number(slotRaw) : 1;
    if (!Number.isFinite(slot) || slot < 1 || slot > 3) {
      throw new Error("instanceSlot must be 1..3 for multi-instance overlays");
    }
    await triggerInstance(sb, {
      sessionId,
      templateKey: legacyKey,
      instanceSlot: slot,
      payload,
      userId: publicUserId,
    });
  } else {
    await triggerOverlay(sb, {
      sessionId,
      templateKey: legacyKey,
      payload,
      userId: publicUserId,
    });
  }

  revalidatePath(`/admin/broadcast/v2/${sessionId}`);
}

/**
 * OUT trigger — clears the latest active row for a v2 overlay key.
 *
 * Multi-instance keys clear the slot-specific row (caller passes
 * instanceSlot 1..3); single-instance keys clear the single active row
 * via getActiveForTemplate.
 */
export async function triggerOverlayOffAction(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  const overlayKey = String(formData.get("overlayKey") ?? "");
  const instanceSlotRaw = String(formData.get("instanceSlot") ?? "");
  const instanceIdHint = String(formData.get("instanceId") ?? "");

  if (!sessionId) throw new Error("sessionId required");
  if (!isV2Key(overlayKey)) {
    throw new Error(`unknown v2 overlay key: ${overlayKey}`);
  }

  const legacyKey: TemplateKey = v2ToLegacy(overlayKey);
  const { sb, publicUserId } = await gateTrigger();

  if (isMultiInstance(legacyKey)) {
    if (instanceIdHint) {
      await clearInstance(sb, instanceIdHint, publicUserId);
    } else {
      const slot = instanceSlotRaw ? Number(instanceSlotRaw) : null;
      const active = await listActiveInstances(sb, sessionId, legacyKey);
      const target =
        slot !== null
          ? active.find((row) => row.instanceSlot === slot)
          : active[0] ?? null;
      if (target) {
        await clearInstance(sb, target.id, publicUserId);
      }
    }
  } else {
    const row = await getActiveForTemplate(sb, sessionId, legacyKey);
    if (row) {
      await clearOverlay(sb, row.id, publicUserId);
    }
  }

  revalidatePath(`/admin/broadcast/v2/${sessionId}`);
}

/**
 * TOGGLE trigger — single action used by the new toggle-switch button on
 * each control card. Probes the current active state of the overlay key
 * (slot-specific for multi-instance) then routes to ENTER (no row) or OFF
 * (row found). The page revalidates after each call so the next render
 * flips the button label / color.
 *
 * FormData fields:
 *  - sessionId       (required)
 *  - overlayKey      (required, V2OverlayKey)
 *  - payload         (JSON string; required for ENTER, ignored for OFF)
 *  - instanceSlot    (1..3; required for multi-instance keys)
 */
export async function toggleOverlayAction(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  const overlayKey = String(formData.get("overlayKey") ?? "");
  const payloadRaw = String(formData.get("payload") ?? "{}");
  const slotRaw = String(formData.get("instanceSlot") ?? "");

  if (!sessionId) throw new Error("sessionId required");
  if (!isV2Key(overlayKey)) {
    throw new Error(`unknown v2 overlay key: ${overlayKey}`);
  }

  const legacyKey: TemplateKey = v2ToLegacy(overlayKey);
  const { sb, publicUserId } = await gateTrigger();

  if (isMultiInstance(legacyKey)) {
    const slot = slotRaw ? Number(slotRaw) : 1;
    if (!Number.isFinite(slot) || slot < 1 || slot > 3) {
      throw new Error("instanceSlot must be 1..3 for multi-instance overlays");
    }
    const active = await listActiveInstances(sb, sessionId, legacyKey);
    const existing = active.find((row) => row.instanceSlot === slot) ?? null;
    if (existing) {
      await clearInstance(sb, existing.id, publicUserId);
    } else {
      const payload = parsePayload(payloadRaw);
      await triggerInstance(sb, {
        sessionId,
        templateKey: legacyKey,
        instanceSlot: slot,
        payload,
        userId: publicUserId,
      });
    }
  } else {
    const existing = await getActiveForTemplate(sb, sessionId, legacyKey);
    if (existing) {
      await clearOverlay(sb, existing.id, publicUserId);
    } else {
      const payload = parsePayload(payloadRaw);
      await triggerOverlay(sb, {
        sessionId,
        templateKey: legacyKey,
        payload,
        userId: publicUserId,
      });
    }
  }

  revalidatePath(`/admin/broadcast/v2/${sessionId}`);
}

/**
 * RE-TRIGGER — used by EDITABLE controls (timer, h2h, lower-third, score-bug,
 * up-next, match-scores-day) where each click should ALWAYS re-fire the
 * payload with the latest field values.
 *
 * Difference from `toggleOverlayAction`:
 *  - Toggle flips ON↔OFF based on current active state.
 *  - Re-trigger ALWAYS fires fresh: if a row is active, clear it first then
 *    trigger with new payload; if no row is active, just trigger.
 *
 * This guarantees re-clicking after editing a field (h2h player swap,
 * lower-third name edit, score-bug player+score change) sends the new
 * payload + replays the entry animation, rather than toggling OFF.
 *
 * FormData fields:
 *  - sessionId       (required)
 *  - overlayKey      (required, V2OverlayKey)
 *  - payload         (JSON string; required — re-trigger always parses)
 *  - instanceSlot    (1..3; required for multi-instance keys)
 */
export async function retriggerOverlayAction(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  const overlayKey = String(formData.get("overlayKey") ?? "");
  const payloadRaw = String(formData.get("payload") ?? "{}");
  const slotRaw = String(formData.get("instanceSlot") ?? "");

  if (!sessionId) throw new Error("sessionId required");
  if (!isV2Key(overlayKey)) {
    throw new Error(`unknown v2 overlay key: ${overlayKey}`);
  }

  const legacyKey: TemplateKey = v2ToLegacy(overlayKey);
  const payload = parsePayload(payloadRaw);
  const { sb, publicUserId } = await gateTrigger();

  if (isMultiInstance(legacyKey)) {
    const slot = slotRaw ? Number(slotRaw) : 1;
    if (!Number.isFinite(slot) || slot < 1 || slot > 3) {
      throw new Error("instanceSlot must be 1..3 for multi-instance overlays");
    }
    const active = await listActiveInstances(sb, sessionId, legacyKey);
    const existing = active.find((row) => row.instanceSlot === slot) ?? null;
    if (existing) {
      await clearInstance(sb, existing.id, publicUserId);
    }
    await triggerInstance(sb, {
      sessionId,
      templateKey: legacyKey,
      instanceSlot: slot,
      payload,
      userId: publicUserId,
    });
  } else {
    const existing = await getActiveForTemplate(sb, sessionId, legacyKey);
    if (existing) {
      await clearOverlay(sb, existing.id, publicUserId);
    }
    await triggerOverlay(sb, {
      sessionId,
      templateKey: legacyKey,
      payload,
      userId: publicUserId,
    });
  }

  revalidatePath(`/admin/broadcast/v2/${sessionId}`);
}
