"use server";

import { redirect } from "next/navigation";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { createMatchDay } from "@/server/matches/match-days";

export async function createMatchDayAction(formData: FormData) {
  const sb = getServiceRoleSupabase();
  const { data: season } = await sb
    .from("seasons")
    .select("id")
    .is("deleted_at", null)
    .eq("status", "active")
    .maybeSingle();
  if (!season) throw new Error("no active season configured");

  const { id } = await createMatchDay(sb, {
    seasonId: season.id,
    matchDate: String(formData.get("matchDate") ?? ""),
    arrivalCutoffTime: String(formData.get("arrivalCutoffTime") ?? ""),
    matchStartTime: String(formData.get("matchStartTime") ?? ""),
    venueName: String(formData.get("venueName") ?? ""),
    notes: formData.get("notes") ? String(formData.get("notes")) : undefined,
  });
  redirect(`/admin/match-days/${id}`);
}
