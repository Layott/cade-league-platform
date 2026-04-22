"use server";

import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect";
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
  if (!season) {
    redirect("/admin/match-days/new?error=no-active-season");
  }

  const matchDate = String(formData.get("matchDate") ?? "");
  try {
    const { id } = await createMatchDay(sb, {
      seasonId: season.id,
      matchDate,
      arrivalCutoffTime: String(formData.get("arrivalCutoffTime") ?? ""),
      matchStartTime: String(formData.get("matchStartTime") ?? ""),
      venueName: String(formData.get("venueName") ?? ""),
      notes: formData.get("notes") ? String(formData.get("notes")) : undefined,
    });
    redirect(`/admin/match-days/${id}`);
  } catch (e) {
    if (isRedirectError(e)) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("match_days_season_id_match_date_key")) {
      redirect(
        `/admin/match-days/new?error=duplicate-date&date=${encodeURIComponent(matchDate)}`
      );
    }
    redirect(
      `/admin/match-days/new?error=create-failed&detail=${encodeURIComponent(msg.slice(0, 200))}`
    );
  }
}
