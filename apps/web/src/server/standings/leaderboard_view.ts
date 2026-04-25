import type { SupabaseClient } from "@supabase/supabase-js";
import { applyTiebreakers, type StandingsRow as TbRow } from "./tiebreakers";

/**
 * Plan 51 — read full season leaderboard with tiebreaker config + form.
 *
 * Single helper used by both the server-rendered Standings tab and the
 * `/api/tournament/leaderboard` route hit by the live-refresh client. Output
 * is the canonical row shape consumed by `LiveLeaderboard`. Rows are
 * pre-sorted via `applyTiebreakers` against `seasons.tiebreaker_order`.
 */

export type LeaderboardRow = {
  pos: number;
  playerId: string;
  name: string;
  gamerTag: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
  form: string;
  pointsAdj: number;
  gdAdj: number;
};

type StandingsViewRow = {
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
    users: { display_name: string | null } | null;
  } | null;
};

type ResultRow = {
  match_id: string;
  home_score: number;
  away_score: number;
  result_type: string | null;
  match: {
    home_player_id: string;
    away_player_id: string;
    season_id: string;
  } | null;
};

export async function loadLeaderboard(
  sb: SupabaseClient,
  seasonId: string,
): Promise<LeaderboardRow[]> {
  const [{ data: standings, error: sErr }, { data: season, error: seasErr }, results] =
    await Promise.all([
      sb
        .from("standings")
        .select(
          `
          player_id,
          matches_played, wins, draws, losses,
          goals_for, goals_against, goal_difference, points,
          punishment_points_deducted, punishment_gd_deducted,
          player:player_id (
            id, gamer_tag,
            users:users!players_user_id_fkey ( id, display_name )
          )
          `,
        )
        .eq("season_id", seasonId)
        .is("deleted_at", null),
      sb
        .from("seasons")
        .select("id, tiebreaker_order")
        .eq("id", seasonId)
        .maybeSingle(),
      readFormResults(sb, seasonId),
    ]);

  if (sErr) throw new Error(`loadLeaderboard standings: ${sErr.message}`);
  if (seasErr) throw new Error(`loadLeaderboard season: ${seasErr.message}`);

  const order =
    (season as { tiebreaker_order?: string[] | null } | null)?.tiebreaker_order ??
    null;

  const rawRows = ((standings ?? []) as unknown as StandingsViewRow[]).map((r) => ({
    raw: r,
    name: r.player?.users?.display_name ?? r.player?.gamer_tag ?? "(unknown)",
    gamerTag: r.player?.gamer_tag ?? "",
  }));

  // Build form map per player (last 5 W/D/L letters, most recent last).
  const formMap = buildFormMap(results);

  // Project to TbRow shape for tiebreaker sort.
  const tbRows: TbRow[] = rawRows.map((r) => ({
    playerId: r.raw.player_id,
    pts: r.raw.points,
    gd: r.raw.goal_difference,
    gf: r.raw.goals_for,
    ga: r.raw.goals_against,
    played: r.raw.matches_played,
    wins: r.raw.wins,
    draws: r.raw.draws,
    losses: r.raw.losses,
    name: r.name,
  }));
  const sorted = applyTiebreakers(tbRows, order);

  // Stitch back to leaderboard row shape, mapping pos by sorted order.
  const byPlayer = new Map(rawRows.map((r) => [r.raw.player_id, r]));
  return sorted.map((row, idx) => {
    const original = byPlayer.get(row.playerId)!;
    return {
      pos: idx + 1,
      playerId: row.playerId,
      name: row.name,
      gamerTag: original.gamerTag,
      played: row.played,
      wins: row.wins,
      draws: row.draws,
      losses: row.losses,
      gf: row.gf,
      ga: row.ga,
      gd: row.gd,
      pts: row.pts,
      form: formMap.get(row.playerId) ?? "",
      pointsAdj: -original.raw.punishment_points_deducted,
      gdAdj: -original.raw.punishment_gd_deducted,
    };
  });
}

async function readFormResults(
  sb: SupabaseClient,
  seasonId: string,
): Promise<ResultRow[]> {
  const { data, error } = await sb
    .from("match_results")
    .select(
      `
      match_id, home_score, away_score, result_type,
      match:match_id ( home_player_id, away_player_id, season_id )
      `,
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`readFormResults: ${error.message}`);
  const rows = (data ?? []) as unknown as ResultRow[];
  return rows.filter((r) => r.match && r.match.season_id === seasonId);
}

/**
 * Build a per-player W/D/L form string from the most recent 5 confirmed
 * results. `result_type='void'` rows are skipped (per the void propagation
 * rule). Rows arrive most-recent-first from `readFormResults`; we build
 * letters newest-first then reverse so the rendered string reads "WDLWW"
 * with the leftmost char being the oldest of the five.
 */
function buildFormMap(results: ResultRow[]): Map<string, string> {
  const out = new Map<string, string[]>();
  for (const r of results) {
    if (!r.match) continue;
    if (r.result_type === "void") continue;
    const home = r.match.home_player_id;
    const away = r.match.away_player_id;
    let homeLetter: "W" | "D" | "L";
    let awayLetter: "W" | "D" | "L";
    if (r.home_score > r.away_score) {
      homeLetter = "W";
      awayLetter = "L";
    } else if (r.home_score < r.away_score) {
      homeLetter = "L";
      awayLetter = "W";
    } else {
      homeLetter = "D";
      awayLetter = "D";
    }
    pushTrim(out, home, homeLetter);
    pushTrim(out, away, awayLetter);
  }
  // Result rows arrived newest-first; appended letters are also newest-first.
  // Reverse each list so the rendered string reads oldest -> newest.
  const final = new Map<string, string>();
  for (const [pid, letters] of out.entries()) {
    final.set(pid, letters.reverse().join(""));
  }
  return final;
}

function pushTrim(map: Map<string, string[]>, pid: string, letter: string) {
  const arr = map.get(pid) ?? [];
  if (arr.length >= 5) return;
  arr.push(letter);
  map.set(pid, arr);
}
