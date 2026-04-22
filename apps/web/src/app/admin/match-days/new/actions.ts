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
  if (!season) {
    redirect("/admin/match-days/new?error=no-active-season");
  }

  const matchDate = String(formData.get("matchDate") ?? "");
  let newId: string | null = null;
  let createError: string | null = null;

  try {
    const { id } = await createMatchDay(sb, {
      seasonId: season.id,
      matchDate,
      arrivalCutoffTime: String(formData.get("arrivalCutoffTime") ?? ""),
      matchStartTime: String(formData.get("matchStartTime") ?? ""),
      venueName: String(formData.get("venueName") ?? ""),
      notes: formData.get("notes") ? String(formData.get("notes")) : undefined,
    });
    newId = id;
  } catch (e) {
    createError = e instanceof Error ? e.message : String(e);
  }

  // All `redirect()` calls live OUTSIDE the try block — `redirect` works by
  // throwing a special NEXT_REDIRECT error that Next.js intercepts. Catching
  // it inside the try would swallow the redirect.
  if (createError) {
    if (createError.includes("match_days_season_id_match_date_key")) {
      redirect(
        `/admin/match-days/new?error=duplicate-date&date=${encodeURIComponent(matchDate)}`
      );
    }
    redirect(
      `/admin/match-days/new?error=create-failed&detail=${encodeURIComponent(createError.slice(0, 200))}`
    );
  }
  redirect(`/admin/match-days/${newId}`);
}
