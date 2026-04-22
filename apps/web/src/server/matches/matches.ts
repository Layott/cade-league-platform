import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createMatchSchema,
  editMatchSchema,
  removeMatchSchema,
  type CreateMatchInput,
  type EditMatchInput,
  type RemoveMatchInput,
} from "./schemas";

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

export async function editMatch(
  sb: SupabaseClient,
  raw: EditMatchInput
): Promise<void> {
  const input = editMatchSchema.parse(raw);
  const { error } = await sb
    .from("matches")
    .update({
      home_player_id: input.homePlayerId,
      away_player_id: input.awayPlayerId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.matchId)
    .is("deleted_at", null);
  if (error) throw new Error(`editMatch failed: ${error.message}`);
}

export async function softDeleteMatch(
  sb: SupabaseClient,
  raw: RemoveMatchInput
): Promise<void> {
  const input = removeMatchSchema.parse(raw);
  const { error } = await sb
    .from("matches")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", input.matchId)
    .is("deleted_at", null);
  if (error) throw new Error(`softDeleteMatch failed: ${error.message}`);
}

export async function listByMatchDay(sb: SupabaseClient, matchDayId: string) {
  const { data, error } = await sb
    .from("matches")
    .select(
      `
      id, status, scheduled_time, notes, match_order,
      home_player:home_player_id ( id, gamer_tag, users:users!players_user_id_fkey ( id, display_name ) ),
      away_player:away_player_id ( id, gamer_tag, users:users!players_user_id_fkey ( id, display_name ) ),
      result:match_results ( id, home_score, away_score, result_type, confirmed_at )
    `
    )
    .eq("match_day_id", matchDayId)
    .is("deleted_at", null)
    .order("match_order", { ascending: true })
    .order("scheduled_time", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`listByMatchDay failed: ${error.message}`);
  return data ?? [];
}

export async function voidMatch(sb: SupabaseClient, matchId: string): Promise<void> {
  const { error } = await sb.from("matches").update({ status: "voided" }).eq("id", matchId);
  if (error) throw new Error(`voidMatch failed: ${error.message}`);
}
