import type { SupabaseClient } from "@supabase/supabase-js";
import {
  scorebarSchema,
  standingsWidgetSchema,
  punishmentTickerSchema,
  playerCardSchema,
  lowerThirdSchema,
  type ScorebarPayload,
  type StandingsWidgetPayload,
  type PunishmentTickerPayload,
  type PlayerCardPayload,
  type LowerThirdPayload,
} from "./schemas";
import { getPlayerHeadshotUrl } from "@/lib/player-photos";

/**
 * Plan 12 — "Auto-fill from live match" helpers.
 *
 * Each helper reads current DB state and produces a schema-valid payload
 * (via `.parse()`) for a given template. Used by the admin trigger
 * grid's Auto-fill button. When no live data is available the helper
 * returns `null` so the UI can fall back to manual entry.
 */

export async function buildScorebarPayload(
  sb: SupabaseClient,
  matchId: string,
): Promise<ScorebarPayload | null> {
  const { data } = await sb
    .from("matches")
    .select(
      `
      id,
      home_player:home_player_id (
        id,
        users:users!players_user_id_fkey ( display_name )
      ),
      away_player:away_player_id (
        id,
        users:users!players_user_id_fkey ( display_name )
      ),
      match_results ( home_score, away_score )
      `,
    )
    .eq("id", matchId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!data) return null;

  const row = data as unknown as {
    id: string;
    home_player: { id: string; users: { display_name: string | null } | null } | null;
    away_player: { id: string; users: { display_name: string | null } | null } | null;
    match_results: { home_score: number | null; away_score: number | null }[] | null;
  };

  const result = row.match_results?.[0] ?? null;
  const homeName = row.home_player?.users?.display_name ?? "Home";
  const awayName = row.away_player?.users?.display_name ?? "Away";

  return scorebarSchema.parse({
    homeName,
    awayName,
    homeScore: result?.home_score ?? 0,
    awayScore: result?.away_score ?? 0,
    matchId: row.id,
  });
}

export async function buildStandingsWidgetPayload(
  sb: SupabaseClient,
  seasonId: string,
  topN: number = 5,
): Promise<StandingsWidgetPayload | null> {
  // Cap topN defensively — matches schema bound.
  const n = Math.min(Math.max(topN, 1), 20);
  const { data } = await sb
    .from("standings")
    .select(
      `
      rank,
      points,
      goal_difference,
      player:player_id (
        users:users!players_user_id_fkey ( display_name )
      )
      `,
    )
    .eq("season_id", seasonId)
    .is("deleted_at", null)
    .order("rank", { ascending: true })
    .limit(n);

  if (!data || data.length === 0) return null;

  const rows = (data as unknown as {
    rank: number;
    points: number;
    goal_difference: number;
    player: { users: { display_name: string | null } | null } | null;
  }[]).map((r) => ({
    rank: r.rank,
    displayName: r.player?.users?.display_name ?? "—",
    pts: r.points,
    gd: r.goal_difference,
  }));

  return standingsWidgetSchema.parse({ topN: rows.length, rows });
}

export async function buildPunishmentTickerPayload(
  sb: SupabaseClient,
  seasonId: string,
  limit: number = 8,
): Promise<PunishmentTickerPayload | null> {
  const n = Math.min(Math.max(limit, 1), 20);
  const { data } = await sb
    .from("disciplinary_actions")
    .select(
      `
      sanction_type,
      magnitude,
      issued_at,
      public_visible,
      player:player_id (
        users:users!players_user_id_fkey ( display_name )
      )
      `,
    )
    .eq("season_id", seasonId)
    .eq("public_visible", true)
    .is("deleted_at", null)
    .order("issued_at", { ascending: false })
    .limit(n);

  if (!data || data.length === 0) return null;

  const items = (data as unknown as {
    sanction_type: string;
    magnitude: string | number | null;
    issued_at: string;
    player: { users: { display_name: string | null } | null } | null;
  }[]).map((r) => ({
    playerName: r.player?.users?.display_name ?? "—",
    sanction: r.sanction_type,
    magnitude: r.magnitude === null ? "" : String(r.magnitude),
    issuedAt: r.issued_at,
  }));

  return punishmentTickerSchema.parse({ items });
}

export async function buildPlayerCardPayload(
  sb: SupabaseClient,
  seasonId: string,
  playerId: string,
): Promise<PlayerCardPayload | null> {
  const { data: player } = await sb
    .from("players")
    .select(
      `
      id,
      gamer_tag,
      photo_url,
      users:users!players_user_id_fkey ( display_name )
      `,
    )
    .eq("id", playerId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!player) return null;

  const p = player as unknown as {
    id: string;
    gamer_tag: string | null;
    photo_url: string | null;
    users: { display_name: string | null } | null;
  };

  const { data: row } = await sb
    .from("standings")
    .select(
      "games_played, wins, draws, losses, goals_for, goals_against, points",
    )
    .eq("season_id", seasonId)
    .eq("player_id", playerId)
    .is("deleted_at", null)
    .maybeSingle();

  const stats = row as
    | {
        games_played: number;
        wins: number;
        draws: number;
        losses: number;
        goals_for: number;
        goals_against: number;
        points: number;
      }
    | null;

  // Plan 32 — prefer the static manifest headshot when the player is in
  // the seeded 13-roster; fall back to the per-row photo_url, otherwise
  // omit so the renderer shows initials.
  const resolvedPhoto =
    getPlayerHeadshotUrl(p.gamer_tag, "transparent", 1) ??
    p.photo_url ??
    undefined;

  return playerCardSchema.parse({
    playerId: p.id,
    displayName: p.users?.display_name ?? p.gamer_tag ?? "—",
    gamerTag: p.gamer_tag ?? "—",
    photoUrl: resolvedPhoto,
    seasonStats: {
      gp: stats?.games_played ?? 0,
      w: stats?.wins ?? 0,
      d: stats?.draws ?? 0,
      l: stats?.losses ?? 0,
      gf: stats?.goals_for ?? 0,
      ga: stats?.goals_against ?? 0,
      pts: stats?.points ?? 0,
    },
  });
}

export async function buildLowerThirdPayload(
  sb: SupabaseClient,
  seasonId: string,
  playerId: string,
): Promise<LowerThirdPayload | null> {
  const { data: player } = await sb
    .from("players")
    .select(
      `
      id,
      gamer_tag,
      jersey_number,
      users:users!players_user_id_fkey ( display_name )
      `,
    )
    .eq("id", playerId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!player) return null;

  const p = player as unknown as {
    id: string;
    gamer_tag: string | null;
    jersey_number: number | null;
    users: { display_name: string | null } | null;
  };

  const { data: row } = await sb
    .from("standings")
    .select("games_played, wins, draws, losses, points")
    .eq("season_id", seasonId)
    .eq("player_id", playerId)
    .is("deleted_at", null)
    .maybeSingle();

  const stats = row as
    | {
        games_played: number;
        wins: number;
        draws: number;
        losses: number;
        points: number;
      }
    | null;

  // Plan 32 — populate photoUrl from the static manifest when available.
  const resolvedLowerThirdPhoto =
    getPlayerHeadshotUrl(p.gamer_tag, "normal", 1) ?? undefined;

  return lowerThirdSchema.parse({
    playerId: p.id,
    displayName: p.users?.display_name ?? p.gamer_tag ?? "—",
    gamerTag: p.gamer_tag ?? "—",
    jerseyNumber: p.jersey_number ?? 0,
    photoUrl: resolvedLowerThirdPhoto,
    stats: stats
      ? {
          gp: stats.games_played,
          w: stats.wins,
          d: stats.draws,
          l: stats.losses,
          pts: stats.points,
        }
      : undefined,
  });
}

// Re-export for barrel import convenience.
export const autofill = {
  scorebar: buildScorebarPayload,
  standingsWidget: buildStandingsWidgetPayload,
  punishmentTicker: buildPunishmentTickerPayload,
  playerCard: buildPlayerCardPayload,
  lowerThird: buildLowerThirdPayload,
};
