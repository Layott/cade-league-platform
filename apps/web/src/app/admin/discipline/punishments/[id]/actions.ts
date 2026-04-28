"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync } from "@/lib/perms-db";
import { enforceAuthedWrite } from "@/lib/api-rate-limit";
import { revoke, softDelete, update, unrevoke, updateSchema } from "@/server/punishments";
import { notify } from "@/server/notifications";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

/**
 * Resolve the owning user_id (`users.id`) for a disciplinary_action.
 * Joins disciplinary_actions → disciplinary_cases → players → users.
 */
async function userIdForAction(
  service: ReturnType<typeof getServiceRoleSupabase>,
  actionId: string,
): Promise<string | null> {
  const { data } = await service
    .from("disciplinary_actions")
    .select(
      "disciplinary_cases!inner ( players!inner ( user_id ) )",
    )
    .eq("id", actionId)
    .maybeSingle();
  const row = data as unknown as
    | { disciplinary_cases: { players: { user_id: string } } }
    | null;
  return row?.disciplinary_cases?.players?.user_id ?? null;
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
  const limited = await enforceAuthedWrite(ctx.pub.id);
  if (limited) throw new Error("rate_limited");

  await revoke(ctx.service, actionId, reason);
  const playerId = await playerIdForAction(ctx.service, actionId);

  try {
    const userId = await userIdForAction(ctx.service, actionId);
    if (userId) {
      await notify(ctx.service, {
        userId,
        kind: "punishment_revoked",
        title: "A punishment against you was revoked",
        body: `An admin has revoked a previous sanction. Reason: ${reason}. Any matches voided by a related ban have been restored automatically.`,
        href: "/profile",
        metadata: { actionId, reason },
      });
    }
  } catch (err) {
    console.error(`[notifications] punishment_revoked fan-out failed: ${String(err)}`);
  }

  revalidatePath("/admin/discipline/punishments");
  revalidatePath(`/admin/discipline/punishments/${actionId}`);
  revalidatePath("/punishments");
  revalidatePath("/profile");
  if (playerId) revalidatePath(`/players/${playerId}`);
  redirect(`/admin/discipline/punishments/${actionId}`);
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
  const limited = await enforceAuthedWrite(ctx.pub.id);
  if (limited) throw new Error("rate_limited");

  const actionId = z
    .string()
    .uuid()
    .parse(String(formData.get("actionId") ?? ""));

  // Sanitize: parse the optional ISO dates BEFORE handing them to the
  // shared updateSchema (which only allows a strict YYYY-MM-DD format,
  // null, or undefined — no `as`-cast strings).
  const efRaw = String(formData.get("effectiveFrom") ?? "").trim();
  const euRaw = String(formData.get("effectiveUntil") ?? "").trim();
  const effectiveFrom = efRaw
    ? z.string().regex(ISO_DATE_RE).parse(efRaw)
    : null;
  const effectiveUntil = euRaw
    ? z.string().regex(ISO_DATE_RE).parse(euRaw)
    : null;

  const updateInput = updateSchema.parse({
    actionId,
    sanctionType: String(formData.get("sanctionType") ?? ""),
    magnitude: formData.get("magnitude") ?? 0,
    effectiveFrom,
    effectiveUntil,
    publicVisible: formData.get("publicVisible") === "on",
    notes: (formData.get("notes") as string) || null,
  });
  await update(ctx.service, updateInput);

  const playerId = await playerIdForAction(ctx.service, actionId);
  revalidatePath("/admin/discipline/punishments");
  revalidatePath(`/admin/discipline/punishments/${actionId}`);
  revalidatePath("/punishments");
  revalidatePath("/profile");
  if (playerId) revalidatePath(`/players/${playerId}`);
  redirect(`/admin/discipline/punishments/${actionId}`);
}

/**
 * Plan 50: clear the `revoked_at` on a disciplinary_action. Used by the
 * "undo revoke" button on the punishment detail page when a previous
 * revoke needs to be reversed (e.g. admin revoked by mistake, or an
 * appeal was undone externally and the cascade left stragglers). The
 * DB trigger on `disciplinary_actions` re-propagates ban voids when
 * `revoked_at` flips back to NULL.
 */
export async function unrevokeAction(formData: FormData) {
  const ctx = await authedAdmin();
  if (!ctx) redirect("/login");
  await requirePermAsync(
    ctx.service,
    { userId: ctx.pub.id, roles: ctx.roles },
    "punishments.edit",
  );
  const limited = await enforceAuthedWrite(ctx.pub.id);
  if (limited) throw new Error("rate_limited");

  const actionId = String(formData.get("actionId") ?? "");
  if (!actionId) return;

  await unrevoke(ctx.service, actionId);
  const playerId = await playerIdForAction(ctx.service, actionId);
  revalidatePath("/admin/discipline/punishments");
  revalidatePath(`/admin/discipline/punishments/${actionId}`);
  revalidatePath("/punishments");
  revalidatePath("/profile");
  revalidatePath("/standings");
  revalidatePath("/fixtures");
  if (playerId) revalidatePath(`/players/${playerId}`);
  redirect(`/admin/discipline/punishments/${actionId}`);
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
  const limited = await enforceAuthedWrite(ctx.pub.id);
  if (limited) throw new Error("rate_limited");

  const actionId = String(formData.get("actionId") ?? "");
  if (!actionId) return;

  // Fetch player BEFORE the soft-delete, so we can still revalidate
  // the /players/[id] surface (post-delete join filters out the row).
  const playerId = await playerIdForAction(ctx.service, actionId);
  await softDelete(ctx.service, actionId);

  revalidatePath("/admin/discipline/punishments");
  revalidatePath("/punishments");
  revalidatePath("/profile");
  if (playerId) revalidatePath(`/players/${playerId}`);
  redirect("/admin/discipline/punishments");
}
