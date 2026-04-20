import type { SupabaseClient } from "@supabase/supabase-js";
import { createMatchDaySchema, type CreateMatchDayInput } from "./schemas";

export type MatchDaySummary = {
  id: string;
  season_id: string;
  match_date: string;
  venue_name: string;
  status: string;
  match_count: number;
};

export async function createMatchDay(
  sb: SupabaseClient,
  raw: CreateMatchDayInput
): Promise<{ id: string }> {
  const input = createMatchDaySchema.parse(raw);

  const { data, error } = await sb
    .from("match_days")
    .insert({
      season_id: input.seasonId,
      match_date: input.matchDate,
      arrival_cutoff_time: input.arrivalCutoffTime,
      match_start_time: input.matchStartTime,
      venue_name: input.venueName,
      notes: input.notes ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`createMatchDay failed: ${error?.message ?? "no data"}`);
  }
  return { id: data.id };
}

export async function listMatchDays(
  sb: SupabaseClient,
  seasonId: string
): Promise<MatchDaySummary[]> {
  const { data, error } = await sb
    .from("match_days")
    .select("id, season_id, match_date, venue_name, status, matches:matches(count)")
    .eq("season_id", seasonId)
    .is("deleted_at", null)
    .order("match_date", { ascending: false });
  if (error) throw new Error(`listMatchDays failed: ${error.message}`);
  return (data ?? []).map(
    (r: {
      id: string;
      season_id: string;
      match_date: string;
      venue_name: string;
      status: string;
      matches: { count: number }[] | null;
    }) => ({
      id: r.id,
      season_id: r.season_id,
      match_date: r.match_date,
      venue_name: r.venue_name,
      status: r.status,
      match_count: r.matches?.[0]?.count ?? 0,
    })
  );
}

export async function getMatchDay(sb: SupabaseClient, id: string) {
  const { data, error } = await sb
    .from("match_days")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error || !data) throw new Error(`match_day ${id} not found`);
  return data;
}
