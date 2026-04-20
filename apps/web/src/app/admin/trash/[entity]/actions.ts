"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { restore } from "@/server/trash";
import { isTrashEntityType } from "@/server/trash/entities";

/**
 * Server Action: restore a soft-deleted row.
 *
 * Admin gating is enforced by middleware at /admin/*. We additionally verify
 * the user has an active session here (belt-and-suspenders). The actual UPDATE
 * runs via the service-role client because the Trash UI needs to clear
 * deleted_at on tables whose RLS policies may not allow the user's own JWT
 * to write (e.g. seasons, disciplinary_actions).
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

  const svc = getServiceRoleSupabase();
  await restore(svc, entityType, id, auth.user.id);

  revalidatePath(`/admin/trash/${entityType}`);
  // Revalidate likely public pages that may now re-include the row.
  revalidatePath("/");
  revalidatePath("/players");
  revalidatePath("/standings");
  revalidatePath("/fixtures");
  revalidatePath("/announcements");
}
