import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

/**
 * Plan 51 — leaderboard XLSX export.
 *
 * Single-sheet workbook readable by Excel + Google Sheets + Numbers. We
 * expose only the league-table columns (Pos / Player / P / W / D / L / GF /
 * GA / GD / Pts / Form) so it stays a one-screen audit document — admins
 * can mail it to organisers without trimming.
 *
 * Form is the last 5 confirmed match results, encoded as W/D/L letters.
 * `goal_events` is queried on a best-effort basis purely to colour the form
 * column; if it errors we fall back to an empty form string per row.
 */

export type LeaderboardXLSXRow = {
  pos: number;
  player: string;
  p: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
  form: string;
};

type StandingsRow = {
  player_id: string;
  matches_played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
  player: {
    gamer_tag: string | null;
    users: { display_name: string | null } | null;
  } | null;
};

type MatchResultRow = {
  match_id: string;
  home_score: number;
  away_score: number;
  created_at: string | null;
  match: {
    home_player_id: string;
    away_player_id: string;
    season_id: string;
  } | null;
};

async function readStandings(
  sb: SupabaseClient,
  seasonId: number | string,
): Promise<StandingsRow[]> {
  const { data, error } = await sb
    .from("standings")
    .select(
      `player_id, matches_played, wins, draws, losses,
       goals_for, goals_against, goal_difference, points,
       player:player_id ( gamer_tag, users:users!players_user_id_fkey ( display_name ) )`,
    )
    .eq("season_id", seasonId)
    .is("deleted_at", null)
    .order("points", { ascending: false })
    .order("goal_difference", { ascending: false })
    .order("goals_for", { ascending: false });
  if (error) throw new Error(`leaderboard standings read: ${error.message}`);
  return (data ?? []) as unknown as StandingsRow[];
}

async function readRecentResults(
  sb: SupabaseClient,
  seasonId: number | string,
): Promise<MatchResultRow[]> {
  const { data, error } = await sb
    .from("match_results")
    .select(
      `match_id, home_score, away_score, created_at,
       match:match_id ( home_player_id, away_player_id, season_id )`,
    )
    .is("deleted_at", null)
    .not("confirmed_at", "is", null);
  if (error) {
    // Best-effort — leaderboard still renders without form column.
    console.warn(`leaderboard form read failed: ${error.message}`);
    return [];
  }
  // Filter season-side here because Supabase's nested .eq() shorthand on a
  // joined column silently no-ops on the cloud (returns all rows). Inline
  // filter keeps form column scoped to the requested season.
  return ((data ?? []) as unknown as MatchResultRow[]).filter(
    (r) => r.match?.season_id === seasonId,
  );
}

function letterFor(score: number, opponent: number): "W" | "D" | "L" {
  if (score > opponent) return "W";
  if (score < opponent) return "L";
  return "D";
}

/**
 * Build last-5 form string per player_id. Sorted by scheduled_for asc, the
 * last 5 entries are most recent. Letters are oldest -> newest left to right.
 */
export function buildFormMap(results: MatchResultRow[]): Map<string, string> {
  const sorted = [...results].sort((a, b) => {
    const at = a.created_at ?? "";
    const bt = b.created_at ?? "";
    return at.localeCompare(bt);
  });
  const perPlayer = new Map<string, string[]>();
  for (const r of sorted) {
    const m = r.match;
    if (!m) continue;
    const home = m.home_player_id;
    const away = m.away_player_id;
    push(perPlayer, home, letterFor(r.home_score, r.away_score));
    push(perPlayer, away, letterFor(r.away_score, r.home_score));
  }
  const out = new Map<string, string>();
  for (const [pid, list] of perPlayer.entries()) {
    out.set(pid, list.slice(-5).join(""));
  }
  return out;
}

function push(m: Map<string, string[]>, k: string, v: string): void {
  const arr = m.get(k) ?? [];
  arr.push(v);
  m.set(k, arr);
}

function rowsForXLSX(
  standings: StandingsRow[],
  formMap: Map<string, string>,
): LeaderboardXLSXRow[] {
  return standings.map((s, idx) => ({
    pos: idx + 1,
    player:
      s.player?.users?.display_name ??
      s.player?.gamer_tag ??
      "(unknown)",
    p: s.matches_played,
    w: s.wins,
    d: s.draws,
    l: s.losses,
    gf: s.goals_for,
    ga: s.goals_against,
    gd: s.goal_difference,
    pts: s.points,
    form: formMap.get(s.player_id) ?? "",
  }));
}

export function buildWorkbook(rows: LeaderboardXLSXRow[]): XLSX.WorkBook {
  const aoa: Array<Array<string | number>> = [
    ["Pos", "Player", "P", "W", "D", "L", "GF", "GA", "GD", "Pts", "Form"],
  ];
  for (const r of rows) {
    aoa.push([
      r.pos,
      r.player,
      r.p,
      r.w,
      r.d,
      r.l,
      r.gf,
      r.ga,
      r.gd,
      r.pts,
      r.form,
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Standings");
  return wb;
}

/**
 * Public API — fetch standings + last-5 form, return a Buffer holding the
 * XLSX bytes. Callers stream this back as `application/vnd.openxmlformats-
 * officedocument.spreadsheetml.sheet`.
 */
export async function generateLeaderboardXLSX(
  seasonId: number | string,
  supabase: SupabaseClient,
): Promise<Buffer> {
  const [standings, results] = await Promise.all([
    readStandings(supabase, seasonId),
    readRecentResults(supabase, seasonId),
  ]);
  const formMap = buildFormMap(results);
  const rows = rowsForXLSX(standings, formMap);
  const wb = buildWorkbook(rows);
  // `bookType: 'xlsx'` ensures we write the OOXML zipped format. `type:
  // 'buffer'` returns a Node Buffer that the API route can pipe directly
  // into the response body.
  const out = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  return out as Buffer;
}
