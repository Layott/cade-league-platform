import type { SupabaseClient } from "@supabase/supabase-js";
import { REALTIME } from "./registry";
import { topScorersSchema, type TopScorersPayload } from "./schemas";
import { getPlayerHeadshotUrl } from "@/lib/player-photos";

/**
 * Audit Slice 1 (2026-04-24) — server reader for the `/overlay/top-scorers`
 * overlay ("Golden Pad").
 *
 * Data source strategy
 * --------------------
 * This overlay needs per-player goal totals — something `public.standings`
 * does NOT store (it only tracks team-level goals_for). Two sources are
 * available:
 *
 *   1. `public.goal_events` (new in migration `20260517000100`) — per-goal
 *      attribution with `own_goal` flag. Authoritative once score-entry
 *      lands per-goal attribution (see header of that migration).
 *   2. `public.player_match_stats.goals` — per-player per-match aggregate
 *      that the Plan 14 OCR pipeline writes into. Already populated for
 *      screenshot-ingested matches.
 *
 * We prefer `goal_events` when any row exists for a match in the target
 * season, and fall back to `player_match_stats.goals` for matches without
 * per-goal rows. This lets top-scorers go live NOW with the OCR-seeded
 * data while future score-entry improvements incrementally shift traffic
 * to `goal_events`.
 *
 * Realtime strategy
 * -----------------
 * The same `public:standings:<seasonId>` channel used by the leaderboard
 * overlay is reused for top-scorers — the DB `recompute_standings()`
 * function is called after every match-result write, so `standings.
 * changed` is a reasonable wake-up signal for "goals probably changed
 * too". (A goal_events-scoped channel would be stricter but today's flow
 * writes `match_results` + `player_match_stats` together; piggybacking on
 * the standings channel avoids an extra DB trigger.)
 */

export type TopScorerRow = {
  rank: number;
  player_id: string;
  player_name: string;
  gamer_tag: string | null;
  goals: number;
  /** Static manifest headshot when player is in the 13-roster. */
  photo_url: string | null;
};

export type TopScorersData = {
  seasonId: string;
  rows: TopScorerRow[];
  /** Realtime channel — re-fires whenever standings recompute. */
  channel: string;
};

/**
 * Fetch top-10 scorers for a season.
 *
 * Implementation:
 *   1. SELECT player_match_stats rows joined to matches filtered by
 *      season_id (since player_match_stats has no season_id column, we
 *      join through matches).
 *   2. SELECT goal_events rows joined to matches filtered by season_id
 *      with own_goal = false.
 *   3. MERGE: per player, prefer the goal_events count when > 0, else
 *      fall back to the player_match_stats aggregate.
 *   4. Sort DESC by goals then ASC by player_name. Take top 10.
 *
 * Players with 0 goals are excluded (schema requires `.max(10)`; zeroes
 * would crowd the list with empty rows).
 */
export async function fetchTopScorersData(
  sb: SupabaseClient,
  seasonId: string,
  topN: number = 10,
): Promise<TopScorersData> {
  const n = Math.min(Math.max(topN, 1), 10);

  // 1. player_match_stats aggregate (per-player goals across the season).
  //    Filter via the matches FK → matches.season_id. Only include rows
  //    whose match_results is confirmed (confirmed_at IS NOT NULL) so
  //    unconfirmed/draft rows don't pollute the list.
  const { data: pmsData, error: pmsErr } = await sb
    .from("player_match_stats")
    .select(
      `
      player_id,
      goals,
      match:match_id!inner (
        season_id,
        deleted_at,
        match_results ( confirmed_at, result_type )
      ),
      player:player_id (
        gamer_tag,
        users:users!players_user_id_fkey ( display_name )
      )
      `,
    )
    .eq("match.season_id", seasonId)
    .is("match.deleted_at", null)
    .is("deleted_at", null);

  if (pmsErr) {
    throw new Error(`fetchTopScorersData pms failed: ${pmsErr.message}`);
  }

  type PmsRow = {
    player_id: string;
    goals: number;
    match: {
      season_id: string;
      match_results:
        | { confirmed_at: string | null; result_type: string | null }[]
        | null;
    } | null;
    player: {
      gamer_tag: string | null;
      users: { display_name: string | null } | null;
    } | null;
  };

  // 2. goal_events aggregate — per-player, own_goal = false.
  //    The goal_events table may be empty (newly created) → the aggregate
  //    will be a no-op and player_match_stats carries the full load.
  const { data: geData, error: geErr } = await sb
    .from("goal_events")
    .select(
      `
      player_id,
      own_goal,
      match:match_id!inner ( season_id, deleted_at ),
      player:player_id (
        gamer_tag,
        users:users!players_user_id_fkey ( display_name )
      )
      `,
    )
    .eq("match.season_id", seasonId)
    .is("match.deleted_at", null)
    .eq("own_goal", false)
    .is("deleted_at", null);

  if (geErr) {
    // `goal_events` might not exist yet (migration unapplied) — don't
    // fail the overlay in that case; just carry on with the pms data.
    // Any other error we re-raise.
    const msg = geErr.message ?? "";
    if (!/relation .+ does not exist/i.test(msg)) {
      throw new Error(`fetchTopScorersData ge failed: ${msg}`);
    }
  }

  type GeRow = {
    player_id: string;
    own_goal: boolean;
    match: { season_id: string } | null;
    player: {
      gamer_tag: string | null;
      users: { display_name: string | null } | null;
    } | null;
  };

  // Build per-player accumulators from both sources.
  type Acc = {
    player_id: string;
    player_name: string;
    gamer_tag: string | null;
    pms_goals: number;
    ge_goals: number;
    match_ids_with_ge: Set<string>;
  };
  const acc = new Map<string, Acc>();

  // geRows first — for each goal_events row, bump ge_goals by 1 and
  // record which match it belongs to so we can suppress the pms goals
  // for that (player, match) tuple in the fallback aggregation.
  const geRows = (geData ?? []) as unknown as (GeRow & {
    match_id?: string;
  })[];
  // Re-query goal_events with match_id explicitly so we can dedupe per
  // (player, match). Supabase embed returns match as nested; match_id
  // isn't automatically expanded — query it directly below.
  const { data: geData2 } = await sb
    .from("goal_events")
    .select(
      `
      player_id,
      match_id,
      own_goal,
      match:match_id!inner ( season_id, deleted_at ),
      player:player_id (
        gamer_tag,
        users:users!players_user_id_fkey ( display_name )
      )
      `,
    )
    .eq("match.season_id", seasonId)
    .is("match.deleted_at", null)
    .eq("own_goal", false)
    .is("deleted_at", null);

  type GeRow2 = {
    player_id: string;
    match_id: string;
    own_goal: boolean;
    match: { season_id: string } | null;
    player: {
      gamer_tag: string | null;
      users: { display_name: string | null } | null;
    } | null;
  };
  const rowsGe = (geData2 ?? []) as unknown as GeRow2[];
  for (const g of rowsGe) {
    const existing = acc.get(g.player_id);
    const playerName =
      g.player?.users?.display_name ?? g.player?.gamer_tag ?? "(unknown)";
    if (existing) {
      existing.ge_goals += 1;
      existing.match_ids_with_ge.add(g.match_id);
    } else {
      acc.set(g.player_id, {
        player_id: g.player_id,
        player_name: playerName,
        gamer_tag: g.player?.gamer_tag ?? null,
        pms_goals: 0,
        ge_goals: 1,
        match_ids_with_ge: new Set([g.match_id]),
      });
    }
  }
  // Silence unused-var lint; geRows kept for parallel future expansion.
  void geRows;

  // pms — for each (player_id, match_id) add goals UNLESS the same
  // (player, match) already has goal_events rows (to avoid double-
  // counting the same match).
  const pmsRows = (pmsData ?? []) as unknown as (PmsRow & {
    match_id?: string;
  })[];
  // Same rationale as above — re-query with match_id column.
  const { data: pmsData2 } = await sb
    .from("player_match_stats")
    .select(
      `
      player_id,
      match_id,
      goals,
      match:match_id!inner (
        season_id,
        deleted_at,
        match_results ( confirmed_at, result_type )
      ),
      player:player_id (
        gamer_tag,
        users:users!players_user_id_fkey ( display_name )
      )
      `,
    )
    .eq("match.season_id", seasonId)
    .is("match.deleted_at", null)
    .is("deleted_at", null);

  type PmsRow2 = {
    player_id: string;
    match_id: string;
    goals: number;
    match: {
      season_id: string;
      match_results:
        | { confirmed_at: string | null; result_type: string | null }[]
        | null;
    } | null;
    player: {
      gamer_tag: string | null;
      users: { display_name: string | null } | null;
    } | null;
  };
  const rowsPms = (pmsData2 ?? []) as unknown as PmsRow2[];
  void pmsRows;
  for (const p of rowsPms) {
    // Skip matches without a confirmed non-void result row — matches
    // standings.recompute's filter (`result_type IN (normal, forfeit)`
    // + `confirmed_at IS NOT NULL`).
    const results = p.match?.match_results ?? [];
    const ok = results.some(
      (r) =>
        r.confirmed_at !== null &&
        (r.result_type === "normal" || r.result_type === "forfeit"),
    );
    if (!ok) continue;
    // Skip when the same (player, match) is already counted by goal_events.
    const existing = acc.get(p.player_id);
    if (existing?.match_ids_with_ge.has(p.match_id)) continue;
    const playerName =
      p.player?.users?.display_name ?? p.player?.gamer_tag ?? "(unknown)";
    if (existing) {
      existing.pms_goals += p.goals;
    } else {
      acc.set(p.player_id, {
        player_id: p.player_id,
        player_name: playerName,
        gamer_tag: p.player?.gamer_tag ?? null,
        pms_goals: p.goals,
        ge_goals: 0,
        match_ids_with_ge: new Set(),
      });
    }
  }

  // Collapse to row + rank, filter 0-goal rows, sort, take top N.
  const merged: Omit<TopScorerRow, "rank">[] = Array.from(acc.values())
    .map((a) => {
      const totalGoals = a.ge_goals + a.pms_goals;
      const photoUrl = a.gamer_tag
        ? getPlayerHeadshotUrl(a.gamer_tag, "transparent", 1)
        : null;
      return {
        player_id: a.player_id,
        player_name: a.player_name,
        gamer_tag: a.gamer_tag,
        goals: totalGoals,
        photo_url: photoUrl,
      };
    })
    .filter((r) => r.goals > 0)
    .sort((a, b) => {
      if (b.goals !== a.goals) return b.goals - a.goals;
      return a.player_name.localeCompare(b.player_name);
    })
    .slice(0, n);

  const rows: TopScorerRow[] = merged.map((r, i) => ({ ...r, rank: i + 1 }));

  return {
    seasonId,
    rows,
    channel: REALTIME.standingsChannel(seasonId),
  };
}

/**
 * Map DB rows to a schema-valid `TopScorersPayload` for the overlay page.
 * Returns a payload with `rows: []` when no scorers (the schema's
 * `.default([])` on rows handles the empty case — overlay renders
 * "NO SCORERS YET").
 */
export function toTopScorersPayload(data: TopScorersData): TopScorersPayload {
  return topScorersSchema.parse({
    rows: data.rows.map((r) => ({
      rank: r.rank,
      displayName: r.player_name,
      goals: r.goals,
      ...(r.photo_url ? { photoUrl: r.photo_url } : {}),
    })),
  });
}

/** Channel name helper re-exported for client code. */
export function topScorersChannelName(seasonId: string): string {
  return REALTIME.standingsChannel(seasonId);
}
