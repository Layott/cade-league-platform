"use server";

import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
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

  const service = getServiceRoleSupabase();
  await issue(service, pub.id, {
    playerId: String(formData.get("playerId")),
    matchId: (formData.get("matchId") as string) || null,
    incidentType: formData.get("incidentType") as
      | "late_arrival"
      | "forfeit"
      | "equipment"
      | "social_media"
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

  redirect("/admin/punishments");
}
