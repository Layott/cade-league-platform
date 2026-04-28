import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { listStandings } from "@/server/standings/read";

// Plan 39 sanitize — alnum/hyphen/underscore guard for `.or()` filter
// interpolation. See server/profile/h2h.ts for rationale.
const safeIdRegex = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "id contains forbidden characters");

/**
 * Plan 41 §3.2 — player stats server module.
 *
 * All helpers are PURE reads from Supabase. Callers supply an already-built
 * SupabaseClient (server-anon or service role; the functions themselves do
 * no auth — perm checks are the caller's responsibility).
 *
 * Void matches (`match_results.result_type = 'void'`) are excluded from
 * every aggregate per Plan 11. Matches without a confirmed result are
 * excluded from form/streaks/history to match what the standings table
 * uses.
 */

export type SeasonStats = {
  mp: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
  pointsDeducted: number;
  gdDeducted: number;
  /** 1-indexed rank in the season standings. `null` if the player isn't in the standings yet. */
  tablePosition: number | null;
};

export type FormEntry = {
  opponentId: string;
  opponentDisplayName: string;
  result: "W" | "D" | "L";
  matchId: string;
  matchDate: string;
  homeScore: number;
  awayScore: number;
  wasHome: boolean;
};

export type Streaks = {
  winStreak: number;
  unbeatenStreak: number;
  goalScoringStreak: number;
};

export type MatchHistoryPage = {
  rows: MatchHistoryRow[];
  pageCount: number;
  page: number;
  pageSize: number;
};

export type MatchHistoryRow = {
  matchId: string;
  matchDate: string;
  opponentId: string;
  opponentDisplayName: string;
  wasHome: boolean;
  homeScore: number;
  awayScore: number;
  resultType: "normal" | "forfeit" | "void";
  result: "W" | "D" | "L";
};

/**
 * Shape of the per-match read used internally. Two levels of join:
 * - match → match_results (0..1 row per match)
 * - match → match_days (for the match_date)
 * - match → home/away player → user (for display_name lookup)
 *
 * The Supabase PostgREST client returns embedded one-to-many as an array
 * even when the foreign side is a guaranteed single row; we normalize on
 * read.
 */
type RawMatchRow = {
  id: string;
  home_player_id: string;
  away_player_id: string;
  match_day_id: string;
  match_days:
    | { match_date: string; deleted_at: string | null }
    | Array<{ match_date: string; deleted_at: string | null }>
    | null;
  match_results:
    | Array<{
        home_score: number;
        away_score: number;
        result_type: "normal" | "forfeit" | "void";
        confirmed_at: string | null;
      }>
    | {
        home_score: number;
        away_score: number;
        result_type: "normal" | "forfeit" | "void";
        confirmed_at: string | null;
      }
    | null;
  home:
    | {
        id: string;
        gamer_tag: string | null;
        users:
          | { display_name: string | null }
          | Array<{ display_name: string | null }>
          | null;
      }
    | null;
  away:
    | {
        id: string;
        gamer_tag: string | null;
        users:
          | { display_name: string | null }
          | Array<{ display_name: string | null }>
          | null;
      }
    | null;
};

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function displayFor(row: {
  gamer_tag: string | null;
  users:
    | { display_name: string | null }
    | Array<{ display_name: string | null }>
    | null;
} | null): string {
  if (!row) return "—";
  const user = pickOne(row.users);
  return user?.display_name ?? row.gamer_tag ?? "—";
}

/**
 * Shared reader for per-player matches. Returns matches sorted by
 * match_date ASC (oldest first) — callers that need another order
 * re-sort. Only matches with a confirmed, non-void result are returned.
 */
async function readPlayerMatches(
  sb: SupabaseClient,
  playerId: string,
  seasonId: string,
): Promise<RawMatchRow[]> {
  // Plan 39 sanitize — alnum/hyphen/underscore-only validate before
  // composing into a `.or()` PostgREST filter string. Punctuation
  // that could escape the filter expression is rejected.
  const safePlayerId = safeIdRegex.parse(playerId);
  const { data, error } = await sb
    .from("matches")
    .select(
      `
      id, home_player_id, away_player_id, match_day_id,
      match_days!inner ( match_date, deleted_at ),
      match_results ( home_score, away_score, result_type, confirmed_at ),
      home:home_player_id ( id, gamer_tag, users:users!players_user_id_fkey ( display_name ) ),
      away:away_player_id ( id, gamer_tag, users:users!players_user_id_fkey ( display_name ) )
      `,
    )
    .eq("season_id", seasonId)
    .is("deleted_at", null)
    .or(`home_player_id.eq.${safePlayerId},away_player_id.eq.${safePlayerId}`);
  if (error) throw new Error(`readPlayerMatches: ${error.message}`);

  const rows = (data ?? []) as unknown as RawMatchRow[];
  return rows
    .filter((r) => pickOne(r.match_days)?.deleted_at === null)
    .filter((r) => {
      const res = pickOne(r.match_results);
      return res != null && res.confirmed_at != null && res.result_type !== "void";
    })
    .sort((a, b) => {
      const da = pickOne(a.match_days)?.match_date ?? "";
      const db = pickOne(b.match_days)?.match_date ?? "";
      return da.localeCompare(db);
    });
}

function resultForPlayer(
  row: RawMatchRow,
  playerId: string,
): { result: "W" | "D" | "L"; gf: number; ga: number; wasHome: boolean } {
  const res = pickOne(row.match_results);
  if (!res) {
    // Caller filters these out, but keep a safe default.
    return { result: "D", gf: 0, ga: 0, wasHome: row.home_player_id === playerId };
  }
  const wasHome = row.home_player_id === playerId;
  const gf = wasHome ? res.home_score : res.away_score;
  const ga = wasHome ? res.away_score : res.home_score;
  let result: "W" | "D" | "L" = "D";
  if (gf > ga) result = "W";
  else if (gf < ga) result = "L";
  return { result, gf, ga, wasHome };
}

export async function getSeasonStats(
  sb: SupabaseClient,
  playerId: string,
  seasonId: string,
): Promise<SeasonStats> {
  const standings = await listStandings(sb, seasonId);
  const idx = standings.findIndex((r) => r.player_id === playerId);

  if (idx === -1) {
    return {
      mp: 0,
      w: 0,
      d: 0,
      l: 0,
      gf: 0,
      ga: 0,
      gd: 0,
      points: 0,
      pointsDeducted: 0,
      gdDeducted: 0,
      tablePosition: null,
    };
  }

  const row = standings[idx];
  return {
    mp: row.matches_played,
    w: row.wins,
    d: row.draws,
    l: row.losses,
    gf: row.goals_for,
    ga: row.goals_against,
    gd: row.goal_difference,
    points: row.points,
    pointsDeducted: row.punishment_points_deducted,
    gdDeducted: row.punishment_gd_deducted,
    tablePosition: idx + 1,
  };
}

/**
 * Last N matches ordered oldest → newest (left-to-right for a UI strip).
 * Void matches are already filtered by `readPlayerMatches`.
 */
export async function getFormLastN(
  sb: SupabaseClient,
  playerId: string,
  seasonId: string,
  n: number = 5,
): Promise<FormEntry[]> {
  const all = await readPlayerMatches(sb, playerId, seasonId);
  // Take the last N (most recent), but return them oldest-first.
  const take = all.slice(Math.max(0, all.length - n));
  return take.map((row) => {
    const { result, wasHome } = resultForPlayer(row, playerId);
    const opp = wasHome ? row.away : row.home;
    const md = pickOne(row.match_days);
    const res = pickOne(row.match_results)!;
    return {
      opponentId: opp?.id ?? "",
      opponentDisplayName: displayFor(opp),
      result,
      matchId: row.id,
      matchDate: md?.match_date ?? "",
      homeScore: res.home_score,
      awayScore: res.away_score,
      wasHome,
    };
  });
}

/**
 * Current active streaks, measured backwards from the most recent match:
 *   - winStreak: consecutive wins from most-recent going back until a non-W.
 *   - unbeatenStreak: consecutive W or D until the first L.
 *   - goalScoringStreak: consecutive matches with >=1 goal scored until a 0-gf match.
 *
 * "Current" means active right now, not an all-season best. Zero if the
 * most-recent match breaks the streak condition.
 */
export async function getCurrentStreaks(
  sb: SupabaseClient,
  playerId: string,
  seasonId: string,
): Promise<Streaks> {
  const all = await readPlayerMatches(sb, playerId, seasonId);
  // Walk most-recent → oldest.
  const reversed = [...all].reverse();
  let winStreak = 0;
  let unbeatenStreak = 0;
  let goalScoringStreak = 0;
  let winLive = true;
  let unbeatenLive = true;
  let gsLive = true;
  for (const row of reversed) {
    const { result, gf } = resultForPlayer(row, playerId);
    if (winLive) {
      if (result === "W") winStreak += 1;
      else winLive = false;
    }
    if (unbeatenLive) {
      if (result === "W" || result === "D") unbeatenStreak += 1;
      else unbeatenLive = false;
    }
    if (gsLive) {
      if (gf > 0) goalScoringStreak += 1;
      else gsLive = false;
    }
    if (!winLive && !unbeatenLive && !gsLive) break;
  }
  return { winStreak, unbeatenStreak, goalScoringStreak };
}

export async function getMatchHistory(
  sb: SupabaseClient,
  playerId: string,
  seasonId: string,
  opts: { page: number; pageSize: number },
): Promise<MatchHistoryPage> {
  const page = Math.max(1, Math.floor(opts.page));
  const pageSize = Math.max(1, Math.floor(opts.pageSize));

  const all = await readPlayerMatches(sb, playerId, seasonId);
  // Most recent first.
  all.reverse();

  const pageCount = Math.max(1, Math.ceil(all.length / pageSize));
  const startIdx = (page - 1) * pageSize;
  const slice = all.slice(startIdx, startIdx + pageSize);

  const rows: MatchHistoryRow[] = slice.map((row) => {
    const { result, wasHome } = resultForPlayer(row, playerId);
    const opp = wasHome ? row.away : row.home;
    const md = pickOne(row.match_days);
    const res = pickOne(row.match_results)!;
    return {
      matchId: row.id,
      matchDate: md?.match_date ?? "",
      opponentId: opp?.id ?? "",
      opponentDisplayName: displayFor(opp),
      wasHome,
      homeScore: res.home_score,
      awayScore: res.away_score,
      resultType: res.result_type,
      result,
    };
  });

  return { rows, pageCount, page, pageSize };
}
