"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync } from "@/lib/perms-db";
import { enforceAuthedWrite } from "@/lib/api-rate-limit";
import { adjustPrecedent, AdjustPrecedentError } from "@/server/precedents";

export async function adjustPrecedentAction(formData: FormData) {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login");

  const { data: rolesRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (rolesRows ?? []).map((r: { role: string }) => r.role);

  const sb = getServiceRoleSupabase();
  await requirePermAsync(sb, { userId: pub.id, roles }, "punishments.edit");
  const limited = await enforceAuthedWrite(pub.id);
  if (limited) throw new Error("rate_limited");

  const playerId = String(formData.get("playerId") ?? "");
  const category = String(formData.get("category") ?? "");
  const deltaRaw = String(formData.get("delta") ?? "+1");
  const delta = deltaRaw === "-1" ? -1 : 1;
  const reason = String(formData.get("reason") ?? "");

  try {
    await adjustPrecedent(sb, pub.id as string, {
      playerId,
      category,
      delta,
      reason,
    });
  } catch (e) {
    if (e instanceof AdjustPrecedentError) {
      redirect(
        `/admin/precedents/${playerId}?error=${encodeURIComponent(e.message)}`,
      );
    }
    throw e;
  }

  revalidatePath(`/admin/precedents/${playerId}`);
  redirect(`/admin/precedents/${playerId}`);
}
