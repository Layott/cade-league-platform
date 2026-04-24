import type { SupabaseClient } from "@supabase/supabase-js";
import { REALTIME } from "./registry";
import {
  leaderboardAnimatedSchema,
  type LeaderboardAnimatedPayload,
} from "./schemas";

/**
 * Audit Slice 1 (2026-04-24) — server reader for the `/overlay/leaderboard-
 * animated` overlay.
 *
 * Read path
 * ---------
 * SELECT from `public.standings` for the given season, ordered by points
 * DESC, goal_difference DESC, goals_for DESC (matches the tiebreaker rule
 * in spec §5 + the `standings_season_points_idx` in migration
 * `20260423000005_standings.sql`). Embeds the player's `display_name` via
 * the `players` → `users` FK chain so the overlay can render a proper
 * name without a second roundtrip.
 *
 * Realtime
 * --------
 * The overlay subscribes to `public:standings:<seasonId>` — the channel
 * published by the DB function `recompute_standings()` (migration
 * `20260518000100_standings_realtime_push.sql`) after every score entry
 * / punishment change. On `standings.changed` the overlay re-runs
 * `fetchLeaderboardData` to refresh its top-N rows.
 *
 * Why topN ≤ 10? The leaderboardAnimatedSchema accepts up to 20 but the
 * Elite 2025-2026 roster is 13 players; we cap at 10 here so the overlay
 * layout (520 px card, 10 rows visible) doesn't spill.
 */

export type LeaderboardRowDb = {
  rank: number;
  player_id: string;
  player_name: string;
  matches_played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
};

export type LeaderboardData = {
  seasonId: string;
  rows: LeaderboardRowDb[];
  /** Supabase Realtime channel name for this season's standings feed. */
  channel: string;
};

/**
 * Fetch the top N standings rows for a season. Order matches the SQL
 * secondary index: points DESC, goal_difference DESC, goals_for DESC.
 *
 * Returns an empty `rows` list (not null) when the season is empty so the
 * overlay can render "NO STANDINGS YET" without a `null`-check.
 *
 * NOTE: the `rank` field is computed server-side from the sorted list
 * index (1-based), NOT from a SQL rank column — the `standings` table
 * has no `rank` column. Sort order is
 * (points desc, goal_difference desc, goals_for desc), the same tiebreak
 * hierarchy `standings_season_points_idx` is built for.
 */
export async function fetchLeaderboardData(
  sb: SupabaseClient,
  seasonId: string,
  topN: number = 10,
): Promise<LeaderboardData> {
  const n = Math.min(Math.max(topN, 1), 10);
  const { data, error } = await sb
    .from("standings")
    .select(
      `
      player_id,
      matches_played, wins, draws, losses,
      goals_for, goals_against, goal_difference, points,
      player:player_id (
        gamer_tag,
        users:users!players_user_id_fkey ( display_name )
      )
      `,
    )
    .eq("season_id", seasonId)
    .is("deleted_at", null)
    .order("points", { ascending: false })
    .order("goal_difference", { ascending: false })
    .order("goals_for", { ascending: false })
    .limit(n);

  if (error) {
    throw new Error(`fetchLeaderboardData failed: ${error.message}`);
  }

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
    player: {
      gamer_tag: string | null;
      users: { display_name: string | null } | null;
    } | null;
  };

  const raw = (data ?? []) as unknown as Row[];
  const rows: LeaderboardRowDb[] = raw.map((r, i) => ({
    rank: i + 1,
    player_id: r.player_id,
    player_name:
      r.player?.users?.display_name ?? r.player?.gamer_tag ?? "(unknown)",
    matches_played: r.matches_played,
    wins: r.wins,
    draws: r.draws,
    losses: r.losses,
    goals_for: r.goals_for,
    goals_against: r.goals_against,
    goal_difference: r.goal_difference,
    points: r.points,
  }));

  return {
    seasonId,
    rows,
    channel: REALTIME.standingsChannel(seasonId),
  };
}

/**
 * Map the DB-level rows into a schema-valid
 * `LeaderboardAnimatedPayload` for the overlay page renderer. `topN`
 * is clamped to the number of rows returned so the zod `.min(1)` passes
 * when the season has at least one player.
 *
 * Returns `null` when the season has zero standings rows — the overlay
 * page then renders a "NO STANDINGS YET" fallback instead of crashing
 * on a `.parse()` of an empty array.
 */
export function toLeaderboardAnimatedPayload(
  data: LeaderboardData,
): LeaderboardAnimatedPayload | null {
  if (data.rows.length === 0) return null;
  const rows = data.rows.map((r) => ({
    rank: r.rank,
    displayName: r.player_name,
    pts: r.points,
    gd: r.goal_difference,
  }));
  return leaderboardAnimatedSchema.parse({
    topN: Math.min(rows.length, 10),
    rows,
  });
}

/** Channel name helper re-exported for client code. */
export function leaderboardChannelName(seasonId: string): string {
  return REALTIME.standingsChannel(seasonId);
}
