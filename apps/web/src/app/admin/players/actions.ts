"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";

async function gate(): Promise<{
  sb: ReturnType<typeof getServiceRoleSupabase>;
  publicUserId: string;
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
  const sb = getServiceRoleSupabase();
  try {
    await requirePermAsync(sb, { userId: pub.id, roles }, "users.edit");
  } catch (e) {
    if (e instanceof PermissionError) {
      throw new Error("Forbidden: missing users.edit");
    }
    throw e;
  }
  return { sb, publicUserId: pub.id };
}

export async function updatePlayerAction(formData: FormData) {
  const playerId = String(formData.get("playerId") ?? "");
  if (!playerId) throw new Error("playerId required");

  const displayName = String(formData.get("displayName") ?? "").trim();
  const gamerTag = String(formData.get("gamerTag") ?? "").trim();
  const psnId = String(formData.get("psnId") ?? "").trim() || null;
  const jerseyRaw = String(formData.get("jerseyNumber") ?? "").trim();
  const bio = String(formData.get("bio") ?? "").trim() || null;
  const photoUrl = String(formData.get("photoUrl") ?? "").trim() || null;
  const orgId = String(formData.get("organizationId") ?? "").trim() || null;
  const coachId = String(formData.get("coachId") ?? "").trim() || null;
  const teamManagerId =
    String(formData.get("teamManagerId") ?? "").trim() || null;

  const jersey = jerseyRaw ? Number(jerseyRaw) : null;
  if (jersey !== null && (!Number.isInteger(jersey) || jersey < 1)) {
    throw new Error("jerseyNumber must be a positive integer");
  }

  const { sb } = await gate();

  // Load player → user_id so we can update display_name on the users table.
  const { data: playerRow, error: pErr } = await sb
    .from("players")
    .select("user_id")
    .eq("id", playerId)
    .is("deleted_at", null)
    .maybeSingle();
  if (pErr) throw pErr;
  if (!playerRow) throw new Error(`player ${playerId} not found`);

  const userId = (playerRow as { user_id: string }).user_id;

  // Update users.display_name if provided.
  if (displayName) {
    const { error: uErr } = await sb
      .from("users")
      .update({ display_name: displayName })
      .eq("id", userId);
    if (uErr) throw uErr;
  }

  // Update players row.
  const patch: Record<string, unknown> = {
    gamer_tag: gamerTag || null,
    psn_id: psnId,
    jersey_number: jersey,
    bio,
    photo_url: photoUrl,
    organization_id: orgId,
    coach_id: coachId,
    team_manager_id: teamManagerId,
  };
  // Drop null-keys where the caller didn't touch them — we want them
  // nulled when cleared via the form, so we keep them. But guard against
  // sending an empty gamer_tag since the schema likely requires one.
  if (!gamerTag) delete patch.gamer_tag;

  const { error: pUpdateErr } = await sb
    .from("players")
    .update(patch)
    .eq("id", playerId)
    .is("deleted_at", null);
  if (pUpdateErr) throw pUpdateErr;

  revalidatePath("/admin/players");
  revalidatePath(`/admin/players/${playerId}/edit`);
  redirect(`/admin/players/${playerId}/edit?saved=1`);
}
