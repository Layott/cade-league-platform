import type { SupabaseClient } from "@supabase/supabase-js";
import { loadLeaderboard } from "./leaderboard_view";
import {
  computeWinProbability,
  type PlayerSeasonStats,
  type H2HRecord,
} from "./win_probability";

/**
 * Plan 51 — H2H comparison data builder.
 *
 * Builds one stat card per selected player using the same leaderboard
 * shape that `LiveLeaderboard` consumes, then computes a "win probability
 * vs the average of the OTHER selected players" so the H2H tab matches
 * what the broadcast overlays display.
 *
 * Last-5 form is reconstructed from match_results within the season —
 * same logic as the leaderboard view, but reshaped into 0-3 numeric form
 * letters for `computeWinProbability`.
 */

export type H2HCard = {
  playerId: string;
  name: string;
  gamerTag: string;
  pos: number | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
  winProbPct: number;
};

export async function buildH2HCards(
  sb: SupabaseClient,
  seasonId: string,
  playerIds: string[],
): Promise<H2HCard[]> {
  if (playerIds.length === 0) return [];

  const leaderboard = await loadLeaderboard(sb, seasonId);
  const byPlayer = new Map(leaderboard.map((r) => [r.playerId, r]));

  // Build PlayerSeasonStats for each selected player + their last5 form
  // (numeric 3/1/0 array).
  const last5Map = await buildLast5Map(sb, seasonId);

  const stats: Record<string, PlayerSeasonStats> = {};
  for (const pid of playerIds) {
    const row = byPlayer.get(pid);
    if (!row) continue;
    stats[pid] = {
      played: row.played,
      wins: row.wins,
      draws: row.draws,
      losses: row.losses,
      gf: row.gf,
      ga: row.ga,
      gd: row.gd,
      points: row.pts,
      last5Form: last5Map.get(pid) ?? [],
    };
  }

  // H2H records between every selected pair, season-scoped.
  const h2hMap = await loadPairwiseH2H(sb, seasonId, playerIds);

  const out: H2HCard[] = [];
  for (const pid of playerIds) {
    const row = byPlayer.get(pid);
    if (!row) continue;
    // Win prob = average against every OTHER selected player.
    const others = playerIds.filter((o) => o !== pid);
    let pSum = 0;
    let pCount = 0;
    for (const oid of others) {
      const aStats = stats[pid];
      const bStats = stats[oid];
      if (!aStats || !bStats) continue;
      const h2h = h2hMap.get(pairKey(pid, oid));
      const aFlipped: H2HRecord | undefined =
        h2h && h2h.firstPlayerId === pid
          ? {
              totalMatches: h2h.totalMatches,
              aWins: h2h.aWins,
              bWins: h2h.bWins,
              draws: h2h.draws,
            }
          : h2h
            ? {
                totalMatches: h2h.totalMatches,
                aWins: h2h.bWins,
                bWins: h2h.aWins,
                draws: h2h.draws,
              }
            : undefined;
      const wp = computeWinProbability(aStats, bStats, aFlipped);
      pSum += wp.pA;
      pCount += 1;
    }
    const winProbPct = pCount > 0 ? pSum / pCount : 0;
    out.push({
      playerId: pid,
      name: row.name,
      gamerTag: row.gamerTag,
      pos: row.pos,
      played: row.played,
      wins: row.wins,
      draws: row.draws,
      losses: row.losses,
      gf: row.gf,
      ga: row.ga,
      gd: row.gd,
      pts: row.pts,
      winProbPct,
    });
  }
  return out;
}

type PairwiseRow = {
  firstPlayerId: string;
  secondPlayerId: string;
  totalMatches: number;
  aWins: number;
  bWins: number;
  draws: number;
};

async function loadPairwiseH2H(
  sb: SupabaseClient,
  seasonId: string,
  playerIds: string[],
): Promise<Map<string, PairwiseRow>> {
  const out = new Map<string, PairwiseRow>();
  if (playerIds.length < 2) return out;

  // Pull every confirmed result in the season for any pair-of-interest.
  // Walkover_pending rows still carry scores but the walkover hasn't been
  // counter-confirmed — they must NOT contribute to H2H counts.
  const { data, error } = await sb
    .from("match_results")
    .select(
      `
      home_score, away_score, result_type, walkover_pending,
      match:match_id (
        home_player_id, away_player_id, season_id
      )
      `,
    )
    .is("deleted_at", null)
    .in("result_type", ["normal", "forfeit"])
    .or("walkover_pending.is.null,walkover_pending.eq.false");

  if (error) return out;

  type Row = {
    home_score: number;
    away_score: number;
    result_type: string;
    walkover_pending: boolean | null;
    match: {
      home_player_id: string;
      away_player_id: string;
      season_id: string;
    } | null;
  };

  const set = new Set(playerIds);
  const rows = (data ?? []) as unknown as Row[];

  for (const r of rows) {
    if (!r.match) continue;
    if (r.match.season_id !== seasonId) continue;
    if (r.walkover_pending === true) continue;
    const a = r.match.home_player_id;
    const b = r.match.away_player_id;
    if (!set.has(a) || !set.has(b)) continue;
    const key = pairKey(a, b);
    const ordered = a < b ? [a, b] : [b, a];
    const entry = out.get(key) ?? {
      firstPlayerId: ordered[0],
      secondPlayerId: ordered[1],
      totalMatches: 0,
      aWins: 0,
      bWins: 0,
      draws: 0,
    };
    entry.totalMatches += 1;
    if (r.home_score === r.away_score) {
      entry.draws += 1;
    } else if (r.home_score > r.away_score) {
      // Home wins.
      if (a === entry.firstPlayerId) entry.aWins += 1;
      else entry.bWins += 1;
    } else {
      // Away wins.
      if (b === entry.firstPlayerId) entry.aWins += 1;
      else entry.bWins += 1;
    }
    out.set(key, entry);
  }

  return out;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Pull recent confirmed results for every player in the season, return
 * a 0-3 form array (most recent first) per player. Stops at length 5.
 */
async function buildLast5Map(
  sb: SupabaseClient,
  seasonId: string,
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  // Match leaderboard form filter: include only confirmed normal/forfeit
  // rows, exclude walkover_pending (request still awaiting counter-confirm).
  const { data, error } = await sb
    .from("match_results")
    .select(
      `
      home_score, away_score, result_type, walkover_pending, created_at,
      match:match_id (
        home_player_id, away_player_id, season_id
      )
      `,
    )
    .is("deleted_at", null)
    .in("result_type", ["normal", "forfeit"])
    .or("walkover_pending.is.null,walkover_pending.eq.false")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) return out;

  type Row = {
    home_score: number;
    away_score: number;
    result_type: string;
    walkover_pending: boolean | null;
    match: {
      home_player_id: string;
      away_player_id: string;
      season_id: string;
    } | null;
  };

  for (const r of (data ?? []) as unknown as Row[]) {
    if (!r.match) continue;
    if (r.match.season_id !== seasonId) continue;
    if (r.walkover_pending === true) continue;
    const home = r.match.home_player_id;
    const away = r.match.away_player_id;
    let homePts: number;
    let awayPts: number;
    if (r.home_score > r.away_score) {
      homePts = 3;
      awayPts = 0;
    } else if (r.home_score < r.away_score) {
      homePts = 0;
      awayPts = 3;
    } else {
      homePts = 1;
      awayPts = 1;
    }
    pushIfRoom(out, home, homePts);
    pushIfRoom(out, away, awayPts);
  }
  return out;
}

function pushIfRoom(map: Map<string, number[]>, pid: string, pts: number) {
  const arr = map.get(pid) ?? [];
  if (arr.length >= 5) return;
  arr.push(pts);
  map.set(pid, arr);
}
