import type { SupabaseClient } from "@supabase/supabase-js";
import { REALTIME } from "./registry";
import {
  leaderboardAnimatedSchema,
  type LeaderboardAnimatedPayload,
} from "./schemas";
import { gamerTagToSlug } from "@/lib/player-photos";
import { resolvePlayerPose } from "./player-photos/resolver";
import {
  buildPhotoUrl,
  getVariantKindForOverlay,
} from "./player-photos/variant-map";
import { buildPowerRankingNarrative } from "./power_rankings_narrative";

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
  /** gamer_tag from players table — used to resolve photo + org assets. */
  slug: string | null;
  /**
   * Plan 53 (2026-05-04) — server-resolved photoUrl from
   * `resolvePlayerPose` + `buildPhotoUrl`. `null` when slug can't be
   * derived; downstream payload mapper falls back to the legacy
   * slug-based path so the wire shape stays compatible.
   */
  photo_url: string | null;
  matches_played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
  /**
   * 2026-05-15 — live disciplinary deductions baked into `points` /
   * `goal_difference`. Surfaced separately so the overlay can render a
   * sanction chip alongside the score without needing a second DB read.
   * Magnitudes are stored as positive integers; downstream payload
   * shaper formats them with the en-dash prefix.
   */
  punishment_points_deducted: number;
  punishment_gd_deducted: number;
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
  topN: number = 13,
): Promise<LeaderboardData> {
  // 2026-04-26 — bumped cap from 10 → 13 so the full Elite roster
  // (13 players) renders. The static overlay HTML is sized for 13
  // rows; the prior cap meant ranks 11-13 were dropped silently.
  const n = Math.min(Math.max(topN, 1), 13);
  const { data, error } = await sb
    .from("standings")
    .select(
      `
      player_id,
      matches_played, wins, draws, losses,
      goals_for, goals_against, goal_difference, points,
      punishment_points_deducted, punishment_gd_deducted,
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
    punishment_points_deducted: number | null;
    punishment_gd_deducted: number | null;
    player: {
      gamer_tag: string | null;
      users: { display_name: string | null } | null;
    } | null;
  };

  const raw = (data ?? []) as unknown as Row[];
  let rows: LeaderboardRowDb[] = raw.map((r, i) => ({
    rank: i + 1,
    player_id: r.player_id,
    player_name:
      r.player?.users?.display_name ?? r.player?.gamer_tag ?? "(unknown)",
    slug: r.player?.gamer_tag ?? null,
    photo_url: null,
    matches_played: r.matches_played,
    wins: r.wins,
    draws: r.draws,
    losses: r.losses,
    goals_for: r.goals_for,
    goals_against: r.goals_against,
    goal_difference: r.goal_difference,
    points: r.points,
    punishment_points_deducted: r.punishment_points_deducted ?? 0,
    punishment_gd_deducted: r.punishment_gd_deducted ?? 0,
  }));

  // Bug 4 fix (2026-04-26) — when `standings` is empty (fresh season,
  // never recomputed) fall back to `season_participants` so the overlay
  // still shows all 13 roster players at 0 pts. Without this, the
  // overlay renders blank until the first match result lands +
  // recompute_standings() seeds the table. User wants 13 zero-pt rows
  // visible from session start.
  if (rows.length === 0) {
    const { data: participants, error: pErr } = await sb
      .from("season_participants")
      .select(
        `
        player_id,
        player:player_id (
          gamer_tag,
          users:users!players_user_id_fkey ( display_name )
        )
        `,
      )
      .eq("season_id", seasonId)
      .is("deleted_at", null)
      .limit(n);

    if (!pErr && participants) {
      type ParticipantRow = {
        player_id: string;
        player: {
          gamer_tag: string | null;
          users: { display_name: string | null } | null;
        } | null;
      };
      const pRows = participants as unknown as ParticipantRow[];
      rows = pRows.map((p, i) => ({
        rank: i + 1,
        player_id: p.player_id,
        player_name:
          p.player?.users?.display_name ?? p.player?.gamer_tag ?? "(unknown)",
        slug: p.player?.gamer_tag ?? null,
        photo_url: null,
        matches_played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goals_for: 0,
        goals_against: 0,
        goal_difference: 0,
        points: 0,
        punishment_points_deducted: 0,
        punishment_gd_deducted: 0,
      }));
    }
  }

  // Plan 53 (2026-05-04) — resolve photoUrl per row via
  // `resolvePlayerPose` + `buildPhotoUrl` so per-(player x overlay)
  // selection rows in `player_photo_selections` win when present.
  // Falls back through the resolver's legacy DEFAULT_POSE_BY_SLUG /
  // pose 1 chain when no DB row exists. The variantKind is
  // `headshot` for `07-leaderboard` per `OVERLAY_VARIANT_KIND`.
  const overlayKey = "07-leaderboard";
  const variantKind = getVariantKindForOverlay(overlayKey);
  rows = await Promise.all(
    rows.map(async (r) => {
      if (!r.slug) return r;
      const slug = gamerTagToSlug(r.slug);
      if (!slug) return r;
      const resolved = await resolvePlayerPose(sb, r.player_id, overlayKey, {
        slug,
      });
      const photoUrl = buildPhotoUrl({
        slug,
        playerId: r.player_id,
        poseIndex: resolved.poseIndex,
        variantKind,
        source: resolved.source,
      });
      return { ...r, photo_url: photoUrl };
    }),
  );

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
/**
 * Slug → org logo URL map (mirrors the shared maps in the v2 overlay
 * static HTML: 04-h2h-2 / 05-h2h-3 / 06-h2h-5 / 07-leaderboard).
 *
 * Kept in sync intentionally — the overlay HTML carries its own copy so
 * the static design files render correctly in standalone smoke mode
 * (`?demo=1`). The server payload is authoritative for live runs.
 */
const PLAYER_ORG_LOGO: Record<string, string | null> = {
  adefola: "/overlays/v2/_assets/Orgs/cade%20esport%20-%20ADEFOLA.png",
  anife: "/overlays/v2/_assets/Orgs/AFROPANDA%20ESPORTS%20-%20ANIFE.jpeg",
  baji_jnr: "/overlays/v2/_assets/Orgs/GameEvo%20Esports%20White%20-%20BAJI%20JNR.png",
  dadaboi: "/overlays/v2/_assets/Orgs/OUTLAWS%20%28WHITE0%20-%20DADABOI.png",
  faruk: "/overlays/v2/_assets/Orgs/OAS%20ESPORTS%20COLORED%20-%20FARUK.png",
  guru: "/overlays/v2/_assets/Orgs/YAKABU%20GLOBAL%20ENTERPRISE%20LIMITED%20-%20GURU.jpg",
  kaykay: "/overlays/v2/_assets/Orgs/LUMO%20LABS%20-%20KAYKAY.png",
  killer_freak: "/overlays/v2/_assets/Orgs/GameEvo%20Esports%20White%20-%20KILLER%20FREAK.png",
  kingnonex: "/overlays/v2/_assets/Orgs/SOLAR%20FLARE%20-%20KING%20NONEX.png",
  king_nonex: "/overlays/v2/_assets/Orgs/SOLAR%20FLARE%20-%20KING%20NONEX.png",
  mitch: "/overlays/v2/_assets/Orgs/PHOENIX%20ESPORTS%20-%20MITCH.png",
  mr_oga: null,
  tactical: "/overlays/v2/_assets/Orgs/FUNQUEST%20ESPORTS%20-%20TACTICAL.jpeg",
  wolevation: "/overlays/v2/_assets/Orgs/BREAKING%20GAMING%20BARRIERS%20LOGO%20-%20WOLEVATION.jpeg",
};

function canonSlug(raw: string | null): string {
  if (!raw) return "";
  const s = raw.toString().toLowerCase().trim();
  // Reuse the same alias rules the overlay HTML uses.
  if (s === "king_nonex") return "kingnonex";
  return s.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function toLeaderboardAnimatedPayload(
  data: LeaderboardData,
): LeaderboardAnimatedPayload | null {
  if (data.rows.length === 0) return null;
  const rows = data.rows.map((r) => {
    const slug = canonSlug(r.slug);
    // Plan 53 (2026-05-04) — server-resolved photoUrl from
    // `fetchLeaderboardData` wins. Legacy slug-based fallback only
    // kicks in when the server reader couldn't derive a slug
    // (extremely rare — would mean the player has no gamer_tag).
    const fallbackPhotoUrl = slug
      ? `/overlays/v2/_assets/players/processed/${slug}/headshot_01_nobg.png`
      : undefined;
    const photoUrl = r.photo_url ?? fallbackPhotoUrl;
    const orgLogoUrl = slug && PLAYER_ORG_LOGO[slug] ? PLAYER_ORG_LOGO[slug]! : undefined;
    // 2026-05-15 — surface live disciplinary deductions into the
    // `sanctions` field the schema already accepts. Format:
    //   "−2 PTS"            (points only)
    //   "−3 GD"             (GD only)
    //   "−2 PTS · −3 GD"    (both). Capped at 40 chars by schema.
    const sanctionPieces: string[] = [];
    if (r.punishment_points_deducted > 0) {
      sanctionPieces.push(`−${r.punishment_points_deducted} PTS`);
    }
    if (r.punishment_gd_deducted > 0) {
      sanctionPieces.push(`−${r.punishment_gd_deducted} GD`);
    }
    const sanctions = sanctionPieces.length > 0
      ? sanctionPieces.join(" · ")
      : undefined;
    const narrative = buildPowerRankingNarrative({
      rank: r.rank,
      p: r.matches_played,
      w: r.wins,
      d: r.draws,
      l: r.losses,
      gf: r.goals_for,
      ga: r.goals_against,
      gd: r.goal_difference,
      pts: r.points,
    });
    return {
      rank: r.rank,
      displayName: r.player_name,
      pts: r.points,
      gd: r.goal_difference,
      slug: slug || undefined,
      photoUrl,
      orgLogoUrl,
      p: r.matches_played,
      w: r.wins,
      d: r.draws,
      l: r.losses,
      gf: r.goals_for,
      ga: r.goals_against,
      sanctions,
      narrative,
    };
  });
  return leaderboardAnimatedSchema.parse({
    topN: Math.min(rows.length, 13),
    rows,
  });
}

/** Channel name helper re-exported for client code. */
export function leaderboardChannelName(seasonId: string): string {
  return REALTIME.standingsChannel(seasonId);
}
