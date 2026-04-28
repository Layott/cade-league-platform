"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync } from "@/lib/perms-db";
import { enforceAuthedWrite } from "@/lib/api-rate-limit";
import { restore } from "@/server/trash";
import { isTrashEntityType } from "@/server/trash/entities";

/**
 * Server Action: restore a soft-deleted row.
 *
 * Plan 39 C4 — re-check perms here. Middleware admits both `admin` and
 * `moderator` to /admin/*; only `admin` should be able to restore deleted
 * rows. Per-action perm re-check enforces that boundary regardless of
 * which roles middleware happens to whitelist.
 */
export async function restoreAction(formData: FormData) {
  const entityType = String(formData.get("entityType") ?? "");
  const id = String(formData.get("id") ?? "");

  if (!isTrashEntityType(entityType)) notFound();
  if (!id) throw new Error("id required");

  const userSb = await getServerSupabase();
  const { data: auth } = await userSb.auth.getUser();
  if (!auth?.user) {
    throw new Error("forbidden");
  }

  // Resolve the public user id + roles for the perm check.
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
  await requirePermAsync(svc, { userId: pub.id, roles }, "trash.restore");
  const limited = await enforceAuthedWrite(pub.id);
  if (limited) throw new Error("rate_limited");

  await restore(svc, entityType, id, auth.user.id);

  revalidatePath(`/admin/trash/${entityType}`);
  // Revalidate likely public pages that may now re-include the row.
  revalidatePath("/");
  revalidatePath("/players");
  revalidatePath("/standings");
  revalidatePath("/fixtures");
  revalidatePath("/announcements");
}
