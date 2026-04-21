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
