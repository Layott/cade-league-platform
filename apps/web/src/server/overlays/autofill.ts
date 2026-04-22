import type { SupabaseClient } from "@supabase/supabase-js";
import {
  scorebarSchema,
  standingsWidgetSchema,
  punishmentTickerSchema,
  playerCardSchema,
  lowerThirdSchema,
  scoreBugSchema,
  upNextBugSchema,
  h2h2Schema,
  type ScorebarPayload,
  type StandingsWidgetPayload,
  type PunishmentTickerPayload,
  type PlayerCardPayload,
  type LowerThirdPayload,
  type ScoreBugPayload,
  type UpNextBugPayload,
  type H2H2Payload,
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

// -- Plan 42 — match-aware autofill helpers -------------------------------
//
// The builders below accept DB rows already loaded by the caller (typically
// `match_flow.startMatch`). Keeping the DB reads in the caller lets a single
// transaction-ish function batch fetches; these builders stay pure mappers
// that emit schema-valid payloads. Each returns `null` on missing inputs so
// the caller can fall back to the STARTER_PAYLOADS stub.

/** Shape used by the match-aware autofill builders. */
export type MatchPlayerLite = {
  id: string;
  gamerTag: string | null;
  displayName: string | null;
  jerseyNumber?: number | null;
};

export type MatchLite = {
  id: string;
  homePlayer: MatchPlayerLite | null;
  awayPlayer: MatchPlayerLite | null;
};

function resolvePhoto(
  gamerTag: string | null,
  variant: "transparent" | "normal" = "transparent",
): string | undefined {
  if (!gamerTag) return undefined;
  return getPlayerHeadshotUrl(gamerTag, variant, 1) ?? undefined;
}

function resolveName(p: MatchPlayerLite | null): string {
  if (!p) return "—";
  return p.displayName ?? p.gamerTag ?? "—";
}

/**
 * Plan 42 / 42.1 — score_bug payload pre-filled from a live match.
 * Starts at 0-0 regardless of DB state; admin increments via
 * `match_flow.updateScoreBug`. The optional `slot` ('primary' |
 * 'secondary') is propagated as a sidecar field on the payload so overlay
 * pages can filter by `?slot=` (Plan 42.1 two-match broadcast).
 */
export function buildScoreBugFromMatch(
  match: MatchLite,
  slot?: "primary" | "secondary",
): (ScoreBugPayload & { slot?: "primary" | "secondary" }) | null {
  if (!match.homePlayer && !match.awayPlayer) return null;
  const parsed = scoreBugSchema.parse({
    players: [
      {
        displayName: resolveName(match.homePlayer),
        photoUrl: resolvePhoto(match.homePlayer?.gamerTag ?? null),
        score: 0,
      },
      {
        displayName: resolveName(match.awayPlayer),
        photoUrl: resolvePhoto(match.awayPlayer?.gamerTag ?? null),
        score: 0,
      },
    ],
    matchId: match.id,
  });
  return slot ? { ...parsed, slot } : parsed;
}

/**
 * Plan 42 / 42.1 — lower_third payload pre-filled from one side of a
 * match. Uses the normal (non-transparent) headshot to match the existing
 * lower-third renderer. Stats are omitted so the admin can choose to
 * include them via the editable panel. The optional `slot` (Plan 42.1) is
 * added as a sidecar field.
 */
export function buildLowerThirdFromPlayer(
  player: MatchPlayerLite | null,
  slot?: "primary" | "secondary",
): (LowerThirdPayload & { slot?: "primary" | "secondary" }) | null {
  if (!player) return null;
  const parsed = lowerThirdSchema.parse({
    playerId: player.id,
    displayName: resolveName(player),
    gamerTag: player.gamerTag ?? "—",
    jerseyNumber: player.jerseyNumber ?? 0,
    photoUrl: resolvePhoto(player.gamerTag ?? null, "normal"),
  });
  return slot ? { ...parsed, slot } : parsed;
}

/**
 * Plan 42 / 42.1 — h2h_2 payload pre-filled from a match.
 * Loads each player's seasonal W/D/L from `standings` in parallel; on any
 * read error the stats are omitted but the displayName + photos still land.
 * Optional `slot` sidecar propagated for Plan 42.1 per-slot routing.
 */
export async function buildH2HFromMatch(
  sb: SupabaseClient,
  match: MatchLite,
  slot?: "primary" | "secondary",
): Promise<(H2H2Payload & { slot?: "primary" | "secondary" }) | null> {
  if (!match.homePlayer || !match.awayPlayer) return null;

  async function statsFor(playerId: string): Promise<
    { w: number; d: number; l: number } | undefined
  > {
    const { data } = await sb
      .from("standings")
      .select("wins, draws, losses")
      .eq("player_id", playerId)
      .is("deleted_at", null)
      .maybeSingle();
    const row = data as { wins: number; draws: number; losses: number } | null;
    return row ? { w: row.wins, d: row.draws, l: row.losses } : undefined;
  }

  const [hs, as] = await Promise.all([
    statsFor(match.homePlayer.id),
    statsFor(match.awayPlayer.id),
  ]);

  const parsed = h2h2Schema.parse({
    players: [
      {
        displayName: resolveName(match.homePlayer),
        gamerTag: match.homePlayer.gamerTag ?? undefined,
        photoUrl: resolvePhoto(match.homePlayer.gamerTag),
        h2hStats: hs,
      },
      {
        displayName: resolveName(match.awayPlayer),
        gamerTag: match.awayPlayer.gamerTag ?? undefined,
        photoUrl: resolvePhoto(match.awayPlayer.gamerTag),
        h2hStats: as,
      },
    ],
  });
  return slot ? { ...parsed, slot } : parsed;
}

/**
 * Plan 42 / 42.1 — up_next_bug pre-filled from the next scheduled match on
 * the session's match_day. Used when the producer wants to tease the next
 * fixture during a BRB window. Returns null when no upcoming match exists.
 * The optional `slot` sidecar is propagated for Plan 42.1 per-slot routing.
 */
export async function buildUpNextFromNextMatch(
  sb: SupabaseClient,
  sessionId: string,
  slot?: "primary" | "secondary",
): Promise<(UpNextBugPayload & { slot?: "primary" | "secondary" }) | null> {
  // Resolve the session → match_day. Read both legacy + new match-id
  // columns so we can exclude whichever slot is live when excluding the
  // "current" match from the "next" lookup.
  const { data: sessRaw } = await sb
    .from("stream_sessions")
    .select(
      "match_day_id, current_match_id, primary_match_id, secondary_match_id",
    )
    .eq("id", sessionId)
    .is("deleted_at", null)
    .maybeSingle();
  const sess = sessRaw as
    | {
        match_day_id: string;
        current_match_id: string | null;
        primary_match_id: string | null;
        secondary_match_id: string | null;
      }
    | null;
  if (!sess) return null;

  // Find the next scheduled match on this match_day (excluding current
  // match ids from either slot + already-completed/forfeited/voided rows).
  const baseQuery = sb
    .from("matches")
    .select(
      `
      id,
      scheduled_time,
      match_day:match_day_id (
        match_date
      ),
      home_player:home_player_id (
        id,
        gamer_tag,
        users:users!players_user_id_fkey ( display_name )
      ),
      away_player:away_player_id (
        id,
        gamer_tag,
        users:users!players_user_id_fkey ( display_name )
      )
      `,
    )
    .eq("match_day_id", sess.match_day_id)
    .eq("status", "scheduled")
    .is("deleted_at", null)
    .order("scheduled_time", { ascending: true })
    .limit(1);

  // Exclude whichever slot is currently active. Prefer the new columns
  // then fall back to the legacy `current_match_id`.
  const exclusions = [
    sess.primary_match_id,
    sess.secondary_match_id,
    sess.current_match_id,
  ].filter((x): x is string => !!x);

  let query = baseQuery;
  for (const excl of exclusions) {
    query = query.neq("id", excl);
  }
  const { data } = await query;

  const rows = data as unknown as
    | {
        id: string;
        scheduled_time: string | null;
        match_day: { match_date: string } | null;
        home_player: {
          id: string;
          gamer_tag: string | null;
          users: { display_name: string | null } | null;
        } | null;
        away_player: {
          id: string;
          gamer_tag: string | null;
          users: { display_name: string | null } | null;
        } | null;
      }[]
    | null;

  const next = rows?.[0];
  if (!next || !next.home_player || !next.away_player) return null;

  const home = next.home_player;
  const away = next.away_player;

  // Compose ISO kickoff: combine match_date + scheduled_time when present.
  // Fall back to the match_date at 00:00Z when the time is missing so the
  // Zod `.datetime()` parse still succeeds.
  const date = next.match_day?.match_date ?? "1970-01-01";
  const time = next.scheduled_time ?? "00:00:00";
  const kickoffAt = new Date(`${date}T${time}Z`).toISOString();

  const parsed = upNextBugSchema.parse({
    home: {
      displayName: home.users?.display_name ?? home.gamer_tag ?? "—",
      gamerTag: home.gamer_tag ?? undefined,
      photoUrl: resolvePhoto(home.gamer_tag),
    },
    away: {
      displayName: away.users?.display_name ?? away.gamer_tag ?? "—",
      gamerTag: away.gamer_tag ?? undefined,
      photoUrl: resolvePhoto(away.gamer_tag),
    },
    kickoffAt,
  });
  return slot ? { ...parsed, slot } : parsed;
}

// Re-export for barrel import convenience.
export const autofill = {
  scorebar: buildScorebarPayload,
  standingsWidget: buildStandingsWidgetPayload,
  punishmentTicker: buildPunishmentTickerPayload,
  playerCard: buildPlayerCardPayload,
  lowerThird: buildLowerThirdPayload,
  // Plan 42
  scoreBugFromMatch: buildScoreBugFromMatch,
  lowerThirdFromPlayer: buildLowerThirdFromPlayer,
  h2hFromMatch: buildH2HFromMatch,
  upNextFromNextMatch: buildUpNextFromNextMatch,
};
