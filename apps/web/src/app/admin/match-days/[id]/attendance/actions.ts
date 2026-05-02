"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { hasPermAsync } from "@/lib/perms-db";
import { enforceAuthedWrite } from "@/lib/api-rate-limit";
import { markPresent, markLate, markAbsent, editMark } from "@/server/attendance";

type PermName = "attendance.mark" | "attendance.edit";

async function requireActor(perm: PermName) {
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

  // Plan 9: DB-backed perm check via role_permissions (cached 30s). Uses
  // the service-role client so we see the full table without user-scoped
  // RLS filtering.
  const sb = getServiceRoleSupabase();
  if (!(await hasPermAsync(sb, { userId: pub.id, roles }, perm))) {
    throw new Error("forbidden");
  }

  const limited = await enforceAuthedWrite(pub.id);
  if (limited) throw new Error("rate_limited");

  // Use service-role client for the mutation path so we control audit context
  // and are not gated by RLS on attendance_marks / disciplinary_* tables.
  return { sb, actorUserId: pub.id as string };
}

export async function markAction(formData: FormData) {
  const matchDayId = String(formData.get("matchDayId") ?? "");
  const playerId = String(formData.get("playerId") ?? "");
  const status = String(formData.get("status") ?? "");
  const { sb, actorUserId } = await requireActor("attendance.mark");

  const input = { matchDayId, playerId, actorUserId };

  // Bug 2 re-fix (2026-05-02): defense-in-depth. If a mark already exists
  // (race between two admin tabs, or page rendered stale because the
  // user-session RLS hid the existing mark before the page-level fix), the
  // mark*() helpers throw ConflictError "player ... already marked". Catch
  // it and route through editMark instead so the click-target surface
  // never 500s. We re-fetch the mark row to grab its id; treat
  // re-mark-as-edit with a short audit reason. requireActor already
  // confirmed attendance.mark; we trust the same actor for the silent edit.
  try {
    if (status === "present") await markPresent(sb, input);
    else if (status === "late") await markLate(sb, input);
    else if (status === "absent") await markAbsent(sb, input);
    else throw new Error(`bad status: ${status}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("already marked")) {
      const { data: existing } = await sb
        .from("attendance_marks")
        .select("id")
        .eq("match_day_id", matchDayId)
        .eq("player_id", playerId)
        .is("deleted_at", null)
        .maybeSingle();
      if (existing?.id) {
        await editMark(sb, {
          markId: String(existing.id),
          newStatus: status as "present" | "late" | "absent",
          reason: "re-mark via dashboard (auto-edit)",
          actorUserId,
        });
      } else {
        throw err;
      }
    } else {
      throw err;
    }
  }

  revalidatePath(`/admin/match-days/${matchDayId}/attendance`);
  revalidatePath("/admin/match-days", "layout");
  revalidatePath("/standings");
}

export async function editAction(formData: FormData) {
  const markId = String(formData.get("markId") ?? "");
  const newStatus = String(formData.get("newStatus") ?? "") as "present" | "late" | "absent";
  const reason = String(formData.get("reason") ?? "").trim();
  const matchDayId = String(formData.get("matchDayId") ?? "");
  if (!reason) throw new Error("override_reason required");

  const { sb, actorUserId } = await requireActor("attendance.edit");
  await editMark(sb, { markId, newStatus, reason, actorUserId });
  revalidatePath(`/admin/match-days/${matchDayId}/attendance`);
  revalidatePath("/standings");
}

export async function undoAction(formData: FormData) {
  const markId = String(formData.get("markId") ?? "");
  const matchDayId = String(formData.get("matchDayId") ?? "");
  const { sb, actorUserId } = await requireActor("attendance.edit");
  await editMark(sb, {
    markId,
    newStatus: "present",
    reason: "undo from attendance screen",
    actorUserId,
  });
  revalidatePath(`/admin/match-days/${matchDayId}/attendance`);
  revalidatePath("/standings");
}
