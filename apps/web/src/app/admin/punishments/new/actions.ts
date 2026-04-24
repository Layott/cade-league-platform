"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync } from "@/lib/perms-db";
import { issue } from "@/server/punishments";

export async function createPunishment(formData: FormData) {
  const sb = await getServerSupabase();
  const { data: authData } = await sb.auth.getUser();
  if (!authData.user) redirect("/login");

  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", authData.user.id)
    .single();
  if (!pub) redirect("/login");

  const { data: rolesRows } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (rolesRows ?? []).map((r: { role: string }) => r.role);

  const service = getServiceRoleSupabase();
  await requirePermAsync(
    service,
    { userId: pub.id, roles },
    "punishments.issue",
  );

  const playerId = String(formData.get("playerId"));
  await issue(service, pub.id, {
    playerId,
    matchId: (formData.get("matchId") as string) || null,
    incidentType: formData.get("incidentType") as
      | "late_arrival"
      | "absent"
      | "forfeit"
      | "equipment"
      | "social_media"
      | "unauthorized_access"
      | "betting"
      | "match_fixing"
      | "dress_code"
      | "other",
    sanctionType: formData.get("sanctionType") as
      | "warning"
      | "point_deduction"
      | "gd_deduction"
      | "forfeit"
      | "ban",
    magnitude: Number(formData.get("magnitude") ?? 0),
    effectiveFrom: (formData.get("effectiveFrom") as string) || undefined,
    effectiveUntil: (formData.get("effectiveUntil") as string) || null,
    publicVisible: formData.get("publicVisible") === "on",
    notes: (formData.get("notes") as string) || undefined,
  });

  revalidatePath("/admin/punishments");
  revalidatePath("/punishments");
  revalidatePath("/profile");
  revalidatePath(`/players/${playerId}`);
  redirect("/admin/punishments");
}
