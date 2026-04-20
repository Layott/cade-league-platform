import type { SupabaseClient } from "@supabase/supabase-js";

export type Season = {
  id: string;
  year_range: string;
  division_name: string;
  start_date: string;
  end_date: string;
  status: "upcoming" | "active" | "completed" | "archived";
};

const COLUMNS = "id, year_range, division_name, start_date, end_date, status";

export async function getActiveSeason(sb: SupabaseClient): Promise<Season | null> {
  const { data, error } = await sb
    .from("seasons")
    .select(COLUMNS)
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as Season | null) ?? null;
}

export async function getSeasonById(
  sb: SupabaseClient,
  id: string
): Promise<Season | null> {
  const { data, error } = await sb
    .from("seasons")
    .select(COLUMNS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as Season | null) ?? null;
}
