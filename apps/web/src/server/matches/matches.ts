import type { SupabaseClient } from "@supabase/supabase-js";
import { createMatchSchema, type CreateMatchInput } from "./schemas";

export async function createMatch(
  sb: SupabaseClient,
  raw: CreateMatchInput
): Promise<{ id: string }> {
  const input = createMatchSchema.parse(raw);

  // Resolve season_id from the match_day row.
  const { data: md, error: mdErr } = await sb
    .from("match_days")
    .select("season_id")
    .eq("id", input.matchDayId)
    .is("deleted_at", null)
    .single();
  if (mdErr || !md) throw new Error(`match_day ${input.matchDayId} not found`);

  const { data, error } = await sb
    .from("matches")
    .insert({
      season_id: md.season_id,
      match_day_id: input.matchDayId,
      home_player_id: input.homePlayerId,
      away_player_id: input.awayPlayerId,
      scheduled_time: input.scheduledTime ?? null,
      notes: input.notes ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`createMatch failed: ${error?.message ?? "no data"}`);
  return { id: data.id };
}

export async function listByMatchDay(sb: SupabaseClient, matchDayId: string) {
  const { data, error } = await sb
    .from("matches")
    .select(
      `
      id, status, scheduled_time, notes,
      home_player:home_player_id ( id, gamer_tag, users:user_id ( id, display_name ) ),
      away_player:away_player_id ( id, gamer_tag, users:user_id ( id, display_name ) ),
      result:match_results ( id, home_score, away_score, result_type, confirmed_at )
    `
    )
    .eq("match_day_id", matchDayId)
    .is("deleted_at", null)
    .order("scheduled_time", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`listByMatchDay failed: ${error.message}`);
  return data ?? [];
}

export async function voidMatch(sb: SupabaseClient, matchId: string): Promise<void> {
  const { error } = await sb.from("matches").update({ status: "voided" }).eq("id", matchId);
  if (error) throw new Error(`voidMatch failed: ${error.message}`);
}
