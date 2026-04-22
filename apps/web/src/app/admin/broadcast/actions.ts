"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { startSession, endSession } from "@/server/broadcast/sessions";
import {
  triggerOverlay,
  clearOverlay,
} from "@/server/broadcast/events";
import {
  createPreset,
  updatePreset,
  deletePreset,
  loadPresetIntoEvent,
} from "@/server/overlays/presets";
import {
  triggerInstance,
  clearInstance,
  updateInstancePayload,
} from "@/server/overlays/instances";
import {
  setClock,
  startClock,
  pauseClock,
  resumeClock,
  adjustClock,
  resetClock,
} from "@/server/overlays/match_clock";
import {
  startMatch,
  endMatch,
  updateScoreBug,
  clearScoreBug,
} from "@/server/broadcast/match_flow";

/**
 * Admin server actions for the broadcast control panel. All actions
 * double-gate: middleware allows admin/moderator; these actions then
 * require `broadcast.manage` (or `broadcast.trigger` for triggers) via
 * requirePermAsync against the DB-backed role_permissions.
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

async function gate(action: string): Promise<{
  sb: ReturnType<typeof getServiceRoleSupabase>;
  publicUserId: string;
}> {
  const { publicUserId, roles } = await resolveAuthed();
  const sb = getServiceRoleSupabase();
  try {
    await requirePermAsync(sb, { userId: publicUserId, roles }, action);
  } catch (e) {
    if (e instanceof PermissionError) {
      throw new Error(`Forbidden: missing ${action}`);
    }
    throw e;
  }
  return { sb, publicUserId };
}

export async function startSessionAction(formData: FormData) {
  const matchDayId = String(formData.get("matchDayId") ?? "");
  const tag = String(formData.get("tag") ?? "").trim() || undefined;
  if (!matchDayId) throw new Error("matchDayId required");

  const { sb, publicUserId } = await gate("broadcast.manage");
  const { id } = await startSession(sb, {
    matchDayId,
    userId: publicUserId,
    tag,
  });
  revalidatePath("/admin/broadcast");
  redirect(`/admin/broadcast/${id}`);
}

export async function endSessionAction(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) throw new Error("sessionId required");
  const { sb, publicUserId } = await gate("broadcast.manage");
  await endSession(sb, sessionId, publicUserId);
  revalidatePath("/admin/broadcast");
  redirect("/admin/broadcast");
}

export async function triggerOverlayAction(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  const templateKey = String(formData.get("templateKey") ?? "");
  const payloadRaw = String(formData.get("payload") ?? "{}");
  let payload: unknown = {};
  try {
    payload = JSON.parse(payloadRaw);
  } catch {
    throw new Error("payload must be valid JSON");
  }

  // Plan 42.1 — the slot-capable templates render a radio button that posts
  // a `slot` form field. When present, override whatever is embedded in the
  // payload JSON so the radio is the source of truth.
  const slotRaw = formData.get("slot");
  if (slotRaw === "primary" || slotRaw === "secondary") {
    payload = {
      ...(payload as Record<string, unknown>),
      slot: slotRaw,
    };
  }

  const { sb, publicUserId } = await gate("broadcast.trigger");
  await triggerOverlay(sb, {
    sessionId,
    templateKey,
    payload,
    userId: publicUserId,
  });
  revalidatePath(`/admin/broadcast/${sessionId}`);
}

export async function clearOverlayAction(formData: FormData) {
  const eventId = String(formData.get("eventId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!eventId) throw new Error("eventId required");
  const { sb, publicUserId } = await gate("broadcast.trigger");
  await clearOverlay(sb, eventId, publicUserId);
  if (sessionId) revalidatePath(`/admin/broadcast/${sessionId}`);
}

// -- Plan 37: presets --------------------------------------------------

function parsePayload(raw: string): unknown {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || trimmed === "undefined") return {};
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown parse error";
    // Surface the exact parser hint (e.g. "Unexpected token ',' ...") so the
    // admin can find the typo instead of staring at a generic red error.
    throw new Error(`payload must be valid JSON — ${msg}`);
  }
}

export async function createPresetAction(formData: FormData) {
  const templateKey = String(formData.get("templateKey") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  const payloadRaw = String(formData.get("payload") ?? "{}");
  const isDefault = formData.get("isDefault") === "on";
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!templateKey) throw new Error("templateKey required");
  if (!label) throw new Error("label required");

  const { sb, publicUserId } = await gate("overlay_presets.manage");
  await createPreset(sb, {
    templateKey,
    label,
    payload: parsePayload(payloadRaw),
    userId: publicUserId,
    isDefault,
  });
  if (sessionId) revalidatePath(`/admin/broadcast/${sessionId}`);
}

export async function updatePresetAction(formData: FormData) {
  const presetId = String(formData.get("presetId") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  const payloadRaw = String(formData.get("payload") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!presetId) throw new Error("presetId required");

  const { sb, publicUserId } = await gate("overlay_presets.manage");
  await updatePreset(sb, presetId, {
    label: label || undefined,
    payload: payloadRaw ? parsePayload(payloadRaw) : undefined,
    userId: publicUserId,
  });
  if (sessionId) revalidatePath(`/admin/broadcast/${sessionId}`);
}

export async function deletePresetAction(formData: FormData) {
  const presetId = String(formData.get("presetId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!presetId) throw new Error("presetId required");
  const { sb, publicUserId } = await gate("overlay_presets.manage");
  await deletePreset(sb, presetId, publicUserId);
  if (sessionId) revalidatePath(`/admin/broadcast/${sessionId}`);
}

export async function loadPresetAction(formData: FormData) {
  const presetId = String(formData.get("presetId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  const slotRaw = String(formData.get("instanceSlot") ?? "");
  const instanceSlot = slotRaw ? Number(slotRaw) : undefined;
  if (!presetId || !sessionId) throw new Error("presetId + sessionId required");

  const { sb, publicUserId } = await gate("broadcast.trigger");
  await loadPresetIntoEvent(sb, {
    presetId,
    sessionId,
    userId: publicUserId,
    instanceSlot,
  });
  revalidatePath(`/admin/broadcast/${sessionId}`);
}

// -- Plan 37: instances ------------------------------------------------

export async function triggerInstanceAction(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  const templateKey = String(formData.get("templateKey") ?? "");
  const slotRaw = String(formData.get("instanceSlot") ?? "1");
  const payloadRaw = String(formData.get("payload") ?? "{}");
  if (!sessionId || !templateKey) throw new Error("session + templateKey required");

  const { sb, publicUserId } = await gate("broadcast.trigger");
  await triggerInstance(sb, {
    sessionId,
    templateKey,
    instanceSlot: Number(slotRaw),
    payload: parsePayload(payloadRaw),
    userId: publicUserId,
  });
  revalidatePath(`/admin/broadcast/${sessionId}`);
}

export async function clearInstanceAction(formData: FormData) {
  const instanceId = String(formData.get("instanceId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!instanceId) throw new Error("instanceId required");
  const { sb, publicUserId } = await gate("broadcast.trigger");
  await clearInstance(sb, instanceId, publicUserId);
  if (sessionId) revalidatePath(`/admin/broadcast/${sessionId}`);
}

export async function updateInstancePayloadAction(formData: FormData) {
  const instanceId = String(formData.get("instanceId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  const payloadRaw = String(formData.get("payload") ?? "{}");
  if (!instanceId) throw new Error("instanceId required");
  const { sb, publicUserId } = await gate("broadcast.trigger");
  await updateInstancePayload(
    sb,
    instanceId,
    parsePayload(payloadRaw),
    publicUserId,
  );
  if (sessionId) revalidatePath(`/admin/broadcast/${sessionId}`);
}

// -- Plan 37: match_clock ---------------------------------------------

export async function setClockAction(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  const mode = String(formData.get("mode") ?? "countdown");
  const secondsRaw = String(formData.get("secondsRemaining") ?? "0");
  const label = String(formData.get("label") ?? "").trim() || null;
  if (!sessionId) throw new Error("sessionId required");
  if (!["countdown", "countup", "paused", "stopped"].includes(mode)) {
    throw new Error(`bad mode: ${mode}`);
  }

  const { sb, publicUserId } = await gate("match_clock.manage");
  await setClock(sb, sessionId, {
    mode: mode as "countdown" | "countup" | "paused" | "stopped",
    secondsRemaining: Number(secondsRaw),
    label,
    userId: publicUserId,
  });
  revalidatePath(`/admin/broadcast/${sessionId}`);
}

export async function startClockAction(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) throw new Error("sessionId required");
  const { sb, publicUserId } = await gate("match_clock.manage");
  await startClock(sb, sessionId, publicUserId);
  revalidatePath(`/admin/broadcast/${sessionId}`);
}

export async function pauseClockAction(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) throw new Error("sessionId required");
  const { sb, publicUserId } = await gate("match_clock.manage");
  await pauseClock(sb, sessionId, publicUserId);
  revalidatePath(`/admin/broadcast/${sessionId}`);
}

export async function resumeClockAction(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) throw new Error("sessionId required");
  const { sb, publicUserId } = await gate("match_clock.manage");
  await resumeClock(sb, sessionId, publicUserId);
  revalidatePath(`/admin/broadcast/${sessionId}`);
}

export async function adjustClockAction(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  const deltaRaw = String(formData.get("deltaSeconds") ?? "0");
  if (!sessionId) throw new Error("sessionId required");
  const { sb, publicUserId } = await gate("match_clock.manage");
  await adjustClock(sb, sessionId, Number(deltaRaw), publicUserId);
  revalidatePath(`/admin/broadcast/${sessionId}`);
}

export async function resetClockAction(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) throw new Error("sessionId required");
  const { sb, publicUserId } = await gate("match_clock.manage");
  await resetClock(sb, sessionId, publicUserId);
  revalidatePath(`/admin/broadcast/${sessionId}`);
}

// -- Plan 42 / 42.1: match flow (select/start/end + score controls) -------
//
// Plan 42.1 — every action reads a `slot` form field ('primary' or
// 'secondary') so the admin UI can drive two concurrent matches.

function readSlot(formData: FormData): "primary" | "secondary" {
  const raw = String(formData.get("slot") ?? "primary");
  return raw === "secondary" ? "secondary" : "primary";
}

export async function selectAndStartMatchAction(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  const matchId = String(formData.get("matchId") ?? "");
  if (!sessionId) throw new Error("sessionId required");
  if (!matchId) throw new Error("matchId required");
  const slot = readSlot(formData);

  const { publicUserId, roles } = await resolveAuthed();
  const sb = getServiceRoleSupabase();
  await startMatch(sb, sessionId, matchId, slot, {
    userId: publicUserId,
    roles,
  });
  revalidatePath(`/admin/broadcast/${sessionId}`);
}

export async function scoreBugDeltaAction(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  const side = String(formData.get("side") ?? "");
  const deltaRaw = String(formData.get("delta") ?? "0");
  if (!sessionId) throw new Error("sessionId required");
  if (side !== "home" && side !== "away") {
    throw new Error("side must be 'home' or 'away'");
  }
  const delta = Number(deltaRaw);
  if (!Number.isFinite(delta)) throw new Error("delta must be numeric");
  const slot = readSlot(formData);

  const { publicUserId, roles } = await resolveAuthed();
  const sb = getServiceRoleSupabase();
  await updateScoreBug(
    sb,
    sessionId,
    slot,
    side === "home" ? { homeDelta: delta } : { awayDelta: delta },
    { userId: publicUserId, roles },
  );
  revalidatePath(`/admin/broadcast/${sessionId}`);
}

export async function resetScoreBugAction(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) throw new Error("sessionId required");
  const slot = readSlot(formData);
  const { publicUserId, roles } = await resolveAuthed();
  const sb = getServiceRoleSupabase();
  await updateScoreBug(
    sb,
    sessionId,
    slot,
    { reset: true },
    { userId: publicUserId, roles },
  );
  revalidatePath(`/admin/broadcast/${sessionId}`);
}

/**
 * Plan 45 — take the score_bug off-stream for a slot without ending the
 * match. Gated on `broadcast.match_control` via `clearScoreBug`.
 */
export async function clearScoreBugAction(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) throw new Error("sessionId required");
  const slot = readSlot(formData);
  const { publicUserId, roles } = await resolveAuthed();
  const sb = getServiceRoleSupabase();
  await clearScoreBug(sb, sessionId, slot, { userId: publicUserId, roles });
  revalidatePath(`/admin/broadcast/${sessionId}`);
}

export async function endMatchAction(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  const homeRaw = String(formData.get("homeScore") ?? "0");
  const awayRaw = String(formData.get("awayScore") ?? "0");
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!sessionId) throw new Error("sessionId required");
  const homeScore = Number(homeRaw);
  const awayScore = Number(awayRaw);
  if (!Number.isInteger(homeScore) || homeScore < 0) {
    throw new Error("homeScore must be a non-negative integer");
  }
  if (!Number.isInteger(awayScore) || awayScore < 0) {
    throw new Error("awayScore must be a non-negative integer");
  }
  const slot = readSlot(formData);

  const { publicUserId, roles } = await resolveAuthed();
  const sb = getServiceRoleSupabase();
  await endMatch(
    sb,
    sessionId,
    slot,
    { homeScore, awayScore, notes },
    { userId: publicUserId, roles },
  );
  revalidatePath(`/admin/broadcast/${sessionId}`);
}
