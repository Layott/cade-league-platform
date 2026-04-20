import type { SupabaseClient } from "@supabase/supabase-js";

export type StandingsRow = {
  player_id: string;
  player_name: string;
  gamer_tag: string;
  matches_played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
  punishment_points_deducted: number;
  punishment_gd_deducted: number;
};

/**
 * Read standings for a season with tiebreaker ordering applied.
 * Tiebreakers (spec §5): points DESC, GD DESC, goals_for DESC.
 * Head-to-head is a Phase 1B concern.
 */
export async function listStandings(
  sb: SupabaseClient,
  seasonId: string
): Promise<StandingsRow[]> {
  const { data, error } = await sb
    .from("standings")
    .select(
      `
      player_id,
      matches_played, wins, draws, losses,
      goals_for, goals_against, goal_difference, points,
      punishment_points_deducted, punishment_gd_deducted,
      player:player_id ( id, gamer_tag, users:user_id ( id, display_name ) )
    `
    )
    .eq("season_id", seasonId)
    .is("deleted_at", null)
    .order("points", { ascending: false })
    .order("goal_difference", { ascending: false })
    .order("goals_for", { ascending: false });

  if (error) throw new Error(`listStandings failed: ${error.message}`);

  type Row = {
    player_id: string;
    matches_played: number;
    wins: number;
    draws: number;
    losses: number;
    goals_for: number;
    goals_against: number;
    goal_difference: number;
    points: number;
    punishment_points_deducted: number;
    punishment_gd_deducted: number;
    player: {
      id: string;
      gamer_tag: string;
      users: { id: string; display_name: string | null } | null;
    } | null;
  };

  return ((data ?? []) as unknown as Row[]).map((r) => ({
    player_id: r.player_id,
    player_name: r.player?.users?.display_name ?? r.player?.gamer_tag ?? "(unknown)",
    gamer_tag: r.player?.gamer_tag ?? "",
    matches_played: r.matches_played,
    wins: r.wins,
    draws: r.draws,
    losses: r.losses,
    goals_for: r.goals_for,
    goals_against: r.goals_against,
    goal_difference: r.goal_difference,
    points: r.points,
    punishment_points_deducted: r.punishment_points_deducted,
    punishment_gd_deducted: r.punishment_gd_deducted,
  }));
}
