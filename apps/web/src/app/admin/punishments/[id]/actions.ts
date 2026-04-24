"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync } from "@/lib/perms-db";
import { revoke, softDelete, update } from "@/server/punishments";

/**
 * Resolve the player_id that owns a given disciplinary_action, so we can
 * revalidate the public /players/[id] + /profile surfaces after any
 * edit/revoke/delete. Returns null silently if the join fails (we still
 * revalidate the non-player surfaces).
 */
async function playerIdForAction(
  service: ReturnType<typeof getServiceRoleSupabase>,
  actionId: string,
): Promise<string | null> {
  const { data } = await service
    .from("disciplinary_actions")
    .select("disciplinary_cases!inner ( player_id )")
    .eq("id", actionId)
    .maybeSingle();
  const row = data as unknown as
    | { disciplinary_cases: { player_id: string } }
    | null;
  return row?.disciplinary_cases?.player_id ?? null;
}

async function authedAdmin(): Promise<{
  service: ReturnType<typeof getServiceRoleSupabase>;
  pub: { id: string };
  roles: string[];
} | null> {
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return null;
  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .single();
  if (!pub) return null;
  const { data: rolesRows } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (rolesRows ?? []).map((r: { role: string }) => r.role);
  return { service: getServiceRoleSupabase(), pub, roles };
}

/**
 * Revoke a disciplinary_action — formal withdrawal with a reason. Distinct
 * from softDelete (typo cleanup). Reason is a required free-text field.
 */
export async function revokeAction(formData: FormData) {
  const actionId = String(formData.get("actionId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!actionId || !reason) return;

  const ctx = await authedAdmin();
  if (!ctx) redirect("/login");
  await requirePermAsync(
    ctx.service,
    { userId: ctx.pub.id, roles: ctx.roles },
    "punishments.edit",
  );

  await revoke(ctx.service, actionId, reason);
  const playerId = await playerIdForAction(ctx.service, actionId);
  revalidatePath("/admin/punishments");
  revalidatePath(`/admin/punishments/${actionId}`);
  revalidatePath("/punishments");
  revalidatePath("/profile");
  if (playerId) revalidatePath(`/players/${playerId}`);
  redirect(`/admin/punishments/${actionId}`);
}

/**
 * Edit a disciplinary_action in place. For typo fixes + adjustments that
 * don't warrant a formal revocation. Audit trigger logs the diff.
 */
export async function updateAction(formData: FormData) {
  const ctx = await authedAdmin();
  if (!ctx) redirect("/login");
  await requirePermAsync(
    ctx.service,
    { userId: ctx.pub.id, roles: ctx.roles },
    "punishments.edit",
  );

  const actionId = String(formData.get("actionId") ?? "");
  if (!actionId) return;

  await update(ctx.service, {
    actionId,
    sanctionType: formData.get("sanctionType") as
      | "warning"
      | "point_deduction"
      | "gd_deduction"
      | "forfeit"
      | "ban",
    magnitude: Number(formData.get("magnitude") ?? 0),
    effectiveFrom: (formData.get("effectiveFrom") as string) || null,
    effectiveUntil: (formData.get("effectiveUntil") as string) || null,
    publicVisible: formData.get("publicVisible") === "on",
    notes: (formData.get("notes") as string) || null,
  });

  const playerId = await playerIdForAction(ctx.service, actionId);
  revalidatePath("/admin/punishments");
  revalidatePath(`/admin/punishments/${actionId}`);
  revalidatePath("/punishments");
  revalidatePath("/profile");
  if (playerId) revalidatePath(`/players/${playerId}`);
  redirect(`/admin/punishments/${actionId}`);
}

/**
 * Soft-delete a disciplinary_action — the row disappears from every list
 * and from the player's precedent tally. Separate from revoke (which is a
 * formal withdrawal with an audit reason). For typo / wrong-player cleanup.
 */
export async function deleteAction(formData: FormData) {
  const ctx = await authedAdmin();
  if (!ctx) redirect("/login");
  await requirePermAsync(
    ctx.service,
    { userId: ctx.pub.id, roles: ctx.roles },
    "punishments.edit",
  );

  const actionId = String(formData.get("actionId") ?? "");
  if (!actionId) return;

  // Fetch player BEFORE the soft-delete, so we can still revalidate
  // the /players/[id] surface (post-delete join filters out the row).
  const playerId = await playerIdForAction(ctx.service, actionId);
  await softDelete(ctx.service, actionId);

  revalidatePath("/admin/punishments");
  revalidatePath("/punishments");
  revalidatePath("/profile");
  if (playerId) revalidatePath(`/players/${playerId}`);
  redirect("/admin/punishments");
}
