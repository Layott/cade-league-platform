"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync } from "@/lib/perms-db";

/**
 * Plan 39 C4 — per-action perm re-check.
 *
 * Middleware admits `admin` + `moderator` to /admin/* but only admins should
 * be able to forcibly revoke another user's session. The service-role write
 * happens after `sessions.revoke` is asserted on the actor.
 */
export async function revokeSession(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  const reason = String(formData.get("reason") ?? "admin_revoke");
  if (!sessionId) return;

  const userSb = await getServerSupabase();
  const { data: auth } = await userSb.auth.getUser();
  if (!auth?.user) throw new Error("forbidden");

  const { data: pub } = await userSb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) throw new Error("forbidden");
  const { data: roleRows } = await userSb
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  const svc = getServiceRoleSupabase();
  await requirePermAsync(svc, { userId: pub.id, roles }, "sessions.revoke");

  await svc
    .from("sessions")
    .update({ revoked_at: new Date().toISOString(), revoke_reason: reason })
    .eq("id", sessionId);
  await svc.from("auth_events").insert({
    user_id: pub.id,
    event_type: "session_revoked",
    metadata: { session_id: sessionId, reason },
  });
  revalidatePath("/admin/security/sessions");
}
