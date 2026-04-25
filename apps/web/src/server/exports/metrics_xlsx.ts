import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { buildFormMap } from "./leaderboard_xlsx";

/**
 * Plan 51 — multi-sheet metrics XLSX export.
 *
 * Sheets:
 *   1. Standings              — same shape as the Leaderboard XLSX.
 *   2. Per-Player Form        — last 5 results (W/D/L letters) per player.
 *   3. Match-Day Results      — flat list of confirmed match_results joined
 *                               with match metadata (md no, scheduled).
 *   4. Walkovers              — match_results filtered to is_walkover=true.
 *   5. Disciplinary Actions   — disciplinary_actions for the season.
 *
 * Each `read*` is wrapped in try/catch -> empty fallback so a single sheet
 * failing (e.g. RLS denial on disciplinary) doesn't kill the export.
 */

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

type MatchResultJoinedRow = {
  id: string;
  match_id: string;
  home_score: number;
  away_score: number;
  result_type: string;
  is_walkover?: boolean | null;
  walkover_initiated_by?: string | null;
  confirmed_at: string | null;
  match: {
    home_player_id: string;
    away_player_id: string;
    season_id: string;
    scheduled_for: string | null;
    match_day_id?: number | null;
  } | null;
};

type DisciplinaryRow = {
  id: string;
  player_id: string;
  incident_type: string;
  step_number: number | null;
  warning_value: number | null;
  match_ban_count: number | null;
  caution_amount: number | null;
  notes: string | null;
  issued_at: string | null;
  season_id: string | null;
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
  if (error) throw new Error(`metrics standings read: ${error.message}`);
  return (data ?? []) as unknown as StandingsRow[];
}

async function readResultsForSeason(
  sb: SupabaseClient,
  seasonId: number | string,
): Promise<MatchResultJoinedRow[]> {
  const { data, error } = await sb
    .from("match_results")
    .select(
      `id, match_id, home_score, away_score, result_type,
       is_walkover, walkover_initiated_by, confirmed_at,
       match:match_id ( home_player_id, away_player_id, season_id, scheduled_for, match_day_id )`,
    )
    .eq("match.season_id", seasonId)
    .is("deleted_at", null);
  if (error) {
    console.warn(`metrics results read failed: ${error.message}`);
    return [];
  }
  return (data ?? []) as unknown as MatchResultJoinedRow[];
}

async function readDisciplinary(
  sb: SupabaseClient,
  seasonId: number | string,
): Promise<DisciplinaryRow[]> {
  const { data, error } = await sb
    .from("disciplinary_actions")
    .select(
      `id, player_id, incident_type, step_number,
       warning_value, match_ban_count, caution_amount,
       notes, issued_at, season_id`,
    )
    .eq("season_id", seasonId)
    .is("deleted_at", null);
  if (error) {
    console.warn(`metrics disciplinary read failed: ${error.message}`);
    return [];
  }
  return (data ?? []) as unknown as DisciplinaryRow[];
}

function nameFor(s: StandingsRow): string {
  return (
    s.player?.users?.display_name ?? s.player?.gamer_tag ?? "(unknown)"
  );
}

function buildStandingsSheet(
  rows: StandingsRow[],
  formMap: Map<string, string>,
): XLSX.WorkSheet {
  const aoa: Array<Array<string | number>> = [
    ["Pos", "Player", "P", "W", "D", "L", "GF", "GA", "GD", "Pts", "Form"],
  ];
  rows.forEach((r, idx) => {
    aoa.push([
      idx + 1,
      nameFor(r),
      r.matches_played,
      r.wins,
      r.draws,
      r.losses,
      r.goals_for,
      r.goals_against,
      r.goal_difference,
      r.points,
      formMap.get(r.player_id) ?? "",
    ]);
  });
  return XLSX.utils.aoa_to_sheet(aoa);
}

function buildPerPlayerFormSheet(
  standings: StandingsRow[],
  formMap: Map<string, string>,
): XLSX.WorkSheet {
  const aoa: Array<Array<string | number>> = [
    ["Player", "Last 5 Form", "Wins", "Draws", "Losses"],
  ];
  for (const s of standings) {
    const form = formMap.get(s.player_id) ?? "";
    const wins = (form.match(/W/g) ?? []).length;
    const draws = (form.match(/D/g) ?? []).length;
    const losses = (form.match(/L/g) ?? []).length;
    aoa.push([nameFor(s), form, wins, draws, losses]);
  }
  return XLSX.utils.aoa_to_sheet(aoa);
}

function buildMatchDaySheet(
  results: MatchResultJoinedRow[],
  nameById: Map<string, string>,
): XLSX.WorkSheet {
  const aoa: Array<Array<string | number>> = [
    [
      "Match Day",
      "Scheduled For",
      "Home Player",
      "Away Player",
      "Home Score",
      "Away Score",
      "Result Type",
      "Confirmed At",
    ],
  ];
  const sorted = [...results].sort((a, b) => {
    const am = a.match?.match_day_id ?? 0;
    const bm = b.match?.match_day_id ?? 0;
    if (am !== bm) return am - bm;
    return (a.match?.scheduled_for ?? "").localeCompare(
      b.match?.scheduled_for ?? "",
    );
  });
  for (const r of sorted) {
    aoa.push([
      r.match?.match_day_id ?? "",
      r.match?.scheduled_for ?? "",
      nameById.get(r.match?.home_player_id ?? "") ?? "",
      nameById.get(r.match?.away_player_id ?? "") ?? "",
      r.home_score,
      r.away_score,
      r.result_type,
      r.confirmed_at ?? "",
    ]);
  }
  return XLSX.utils.aoa_to_sheet(aoa);
}

function buildWalkoversSheet(
  results: MatchResultJoinedRow[],
  nameById: Map<string, string>,
): XLSX.WorkSheet {
  const aoa: Array<Array<string | number>> = [
    [
      "Match Day",
      "Scheduled For",
      "Home Player",
      "Away Player",
      "Home Score",
      "Away Score",
      "Initiated By",
    ],
  ];
  for (const r of results.filter((r) => r.is_walkover === true)) {
    aoa.push([
      r.match?.match_day_id ?? "",
      r.match?.scheduled_for ?? "",
      nameById.get(r.match?.home_player_id ?? "") ?? "",
      nameById.get(r.match?.away_player_id ?? "") ?? "",
      r.home_score,
      r.away_score,
      r.walkover_initiated_by ?? "",
    ]);
  }
  return XLSX.utils.aoa_to_sheet(aoa);
}

function buildDisciplinarySheet(
  rows: DisciplinaryRow[],
  nameById: Map<string, string>,
): XLSX.WorkSheet {
  const aoa: Array<Array<string | number>> = [
    [
      "Player",
      "Incident",
      "Step",
      "Warning Value",
      "Match Ban Count",
      "Caution Amount",
      "Issued At",
      "Notes",
    ],
  ];
  for (const r of rows) {
    aoa.push([
      nameById.get(r.player_id) ?? r.player_id,
      r.incident_type,
      r.step_number ?? "",
      r.warning_value ?? "",
      r.match_ban_count ?? "",
      r.caution_amount ?? "",
      r.issued_at ?? "",
      r.notes ?? "",
    ]);
  }
  return XLSX.utils.aoa_to_sheet(aoa);
}

export function buildMetricsWorkbook(opts: {
  standings: StandingsRow[];
  formMap: Map<string, string>;
  results: MatchResultJoinedRow[];
  disciplinary: DisciplinaryRow[];
}): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  // Build a player name lookup once.
  const nameById = new Map<string, string>();
  for (const s of opts.standings) {
    nameById.set(s.player_id, nameFor(s));
  }
  XLSX.utils.book_append_sheet(
    wb,
    buildStandingsSheet(opts.standings, opts.formMap),
    "Standings",
  );
  XLSX.utils.book_append_sheet(
    wb,
    buildPerPlayerFormSheet(opts.standings, opts.formMap),
    "Per-Player Form",
  );
  XLSX.utils.book_append_sheet(
    wb,
    buildMatchDaySheet(opts.results, nameById),
    "Match-Day Results",
  );
  XLSX.utils.book_append_sheet(
    wb,
    buildWalkoversSheet(opts.results, nameById),
    "Walkovers",
  );
  XLSX.utils.book_append_sheet(
    wb,
    buildDisciplinarySheet(opts.disciplinary, nameById),
    "Disciplinary Actions",
  );
  return wb;
}

export async function generateMetricsXLSX(
  seasonId: number | string,
  supabase: SupabaseClient,
): Promise<Buffer> {
  const [standings, results, disciplinary] = await Promise.all([
    readStandings(supabase, seasonId),
    readResultsForSeason(supabase, seasonId),
    readDisciplinary(supabase, seasonId),
  ]);
  const formMap = buildFormMap(
    results.map((r) => ({
      match_id: r.match_id,
      home_score: r.home_score,
      away_score: r.away_score,
      match: r.match
        ? {
            home_player_id: r.match.home_player_id,
            away_player_id: r.match.away_player_id,
            season_id: r.match.season_id,
            scheduled_for: r.match.scheduled_for,
          }
        : null,
    })),
  );
  const wb = buildMetricsWorkbook({
    standings,
    formMap,
    results,
    disciplinary,
  });
  const out = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  return out as Buffer;
}
