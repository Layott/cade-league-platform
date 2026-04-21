import type { SupabaseClient } from "@supabase/supabase-js";

export type ObligationStatus = {
  player_id: string;
  week_start: string;
  post_count: number;
  verified_platforms: number;
  met: boolean;
};

/**
 * Read the `content_obligation_status` view for one (player, week). If the
 * player has submitted nothing, we synthesise a zero-row.
 */
export async function getStatusForPlayerWeek(
  sb: SupabaseClient,
  playerId: string,
  weekStart: string,
): Promise<ObligationStatus> {
  const { data, error } = await sb
    .from("content_obligation_status")
    .select("*")
    .eq("player_id", playerId)
    .eq("week_start", weekStart)
    .maybeSingle();
  if (error) {
    throw new Error(`getStatusForPlayerWeek: ${error.message}`);
  }
  if (data) return data as ObligationStatus;
  return {
    player_id: playerId,
    week_start: weekStart,
    post_count: 0,
    verified_platforms: 0,
    met: false,
  };
}

export async function listWeekForAllPlayers(
  sb: SupabaseClient,
  weekStart: string,
): Promise<ObligationStatus[]> {
  const { data, error } = await sb
    .from("content_obligation_status")
    .select("*")
    .eq("week_start", weekStart);
  if (error) {
    throw new Error(`listWeekForAllPlayers: ${error.message}`);
  }
  return (data ?? []) as ObligationStatus[];
}
