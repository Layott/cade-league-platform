import type { SupabaseClient } from "@supabase/supabase-js";
import { loadLeaderboard } from "./leaderboard_view";
import {
  computeWinProbability,
  type PlayerSeasonStats,
  type H2HRecord,
} from "./win_probability";
import { resolvePlayerPose } from "@/server/overlays/player-photos/resolver";
import {
  buildPhotoUrl,
  getVariantKindForOverlay,
} from "@/server/overlays/player-photos/variant-map";

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
  /**
   * Lowercased gamer_tag with non-alphanumerics → "_" so the static H2H
   * overlays (`04-h2h-2`, `05-h2h-3`, `06-h2h-5`) can fall back to their
   * baked-in `PLAYER_PHOTO[slug]` map when the server doesn't send a
   * photoUrl, AND join slugged display rules (`PLAYER_ORG_NAME[slug]`)
   * to per-card render output.
   */
  slug: string;
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
  drawProbPct: number;
  /**
   * Per-player org logo URL resolved from `players.organization_id →
   * organizations.logo_url`. Source of truth is the admin Orgs UI (see
   * `/admin/people/orgs/<id>` logo upload widget). Falls back to the
   * static slug map (`PLAYER_ORG[slug]`) inside the overlay HTML when
   * null. Bug fix 2026-05-02 — without this field, the h2h overlays
   * always used the static map, which pinned FARUK to "OAS PLAIN" even
   * after the admin uploaded the colored variant.
   */
  orgLogoUrl: string | null;
  /**
   * Per-player headshot URL pulled from `players.photo_url`. Same
   * fallback rule as `orgLogoUrl` — null lets the overlay fall back to
   * the baked-in `PLAYER_PHOTO[slug]` map.
   */
  photoUrl: string | null;
};

export async function buildH2HCards(
  sb: SupabaseClient,
  seasonId: string,
  playerIds: string[],
  opts: { overlayKey?: string | null } = {},
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

  // Bug fix 2026-05-02 — pull org logo for every selected player so the
  // H2H overlays don't fall back to the static `PLAYER_ORG[slug]` map
  // (which pins FARUK to OAS PLAIN even when the admin has uploaded a
  // new colored variant via /admin/people/orgs/). The admin-supplied
  // `organizations.logo_url` is the source of truth.
  //
  // Plan 53 (2026-05-04): photoUrl now flows through `resolvePlayerPose`
  // + `buildPhotoUrl` so per-overlay / per-player selection rows in
  // `player_photo_selections` win over the legacy `players.photo_url`
  // column. The resolver falls back to legacy DEFAULT_POSE_BY_SLUG +
  // pose 1 when no DB row exists, preserving prior behaviour.
  const profileMap = await loadPlayerProfiles(
    sb,
    playerIds,
    opts.overlayKey ?? null,
  );

  const out: H2HCard[] = [];
  for (const pid of playerIds) {
    const row = byPlayer.get(pid);
    if (!row) continue;
    // Win prob + draw prob = average against every OTHER selected player.
    const others = playerIds.filter((o) => o !== pid);
    let pSum = 0;
    let dSum = 0;
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
      dSum += wp.pDraw;
      pCount += 1;
    }
    const winProbPct = pCount > 0 ? pSum / pCount : 0;
    const drawProbPct = pCount > 0 ? dSum / pCount : 0;
    const profile = profileMap.get(pid) ?? null;
    out.push({
      playerId: pid,
      name: row.name,
      gamerTag: row.gamerTag,
      slug: tagToSlug(row.gamerTag),
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
      drawProbPct,
      orgLogoUrl: profile?.orgLogoUrl ?? null,
      photoUrl: profile?.photoUrl ?? null,
    });
  }
  return out;
}

/**
 * Bug fix 2026-05-02 — resolve per-player org logo + headshot from the
 * DB so the H2H broadcast overlays render the admin-managed visuals
 * instead of the baked-in static slug map.
 *
 * Source of truth chain:
 *   `players.organization_id`  →  `organizations.logo_url`
 *   resolver(player_id, overlayKey) → `buildPhotoUrl(...)`        (Plan 53)
 *
 * Plan 53 (2026-05-04) — photoUrl is now derived via `resolvePlayerPose`
 * (per-overlay override → global default → legacy DEFAULT_POSE_BY_SLUG →
 * pose 1) and `buildPhotoUrl`, NOT the legacy `players.photo_url`
 * column. The resolver consults `player_photo_selections` so admins can
 * tune the displayed pose per (player, overlay) without code edits.
 *
 * Returns a Map keyed by player id. Missing rows / null FKs simply
 * collapse to null on each field; the overlay HTML falls back to the
 * static `PLAYER_ORG[slug]` / `PLAYER_PHOTO[slug]` maps in that case.
 */
type PlayerProfile = { orgLogoUrl: string | null; photoUrl: string | null };

async function loadPlayerProfiles(
  sb: SupabaseClient,
  playerIds: string[],
  overlayKey: string | null,
): Promise<Map<string, PlayerProfile>> {
  const out = new Map<string, PlayerProfile>();
  if (playerIds.length === 0) return out;

  const { data, error } = await sb
    .from("players")
    .select(
      `
      id,
      gamer_tag,
      organization:organization_id ( logo_url )
      `,
    )
    .in("id", playerIds)
    .is("deleted_at", null);
  if (error) {
    // Soft-fail — missing org/photo data should NOT take down the H2H
    // endpoint. The overlays fall back to static slug maps when these
    // fields are null.
    return out;
  }

  type Row = {
    id: string;
    gamer_tag: string | null;
    organization:
      | { logo_url: string | null }
      | { logo_url: string | null }[]
      | null;
  };

  const variantKind = getVariantKindForOverlay(overlayKey ?? "");

  for (const r of (data ?? []) as unknown as Row[]) {
    const org = r.organization;
    let orgLogoUrl: string | null = null;
    if (org) {
      if (Array.isArray(org)) {
        orgLogoUrl = org[0]?.logo_url ?? null;
      } else {
        orgLogoUrl = org.logo_url ?? null;
      }
    }
    const slug = tagToSlug(r.gamer_tag ?? "");
    let photoUrl: string | null = null;
    if (slug) {
      const resolved = await resolvePlayerPose(sb, r.id, overlayKey, { slug });
      photoUrl = buildPhotoUrl({
        slug,
        playerId: r.id,
        poseIndex: resolved.poseIndex,
        variantKind,
        source: resolved.source,
      });
    }
    out.set(r.id, {
      orgLogoUrl,
      photoUrl,
    });
  }
  return out;
}

/**
 * Lowercase + strip non-alphanumerics → `_`. Mirrors the slug rule the
 * static H2H overlays use to look up `PLAYER_PHOTO[slug]` /
 * `PLAYER_ORG[slug]` / `PLAYER_ORG_NAME[slug]`. Empty input → "".
 */
function tagToSlug(tag: string): string {
  if (!tag) return "";
  return tag
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
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

// 2026-05-10 — form window expanded from 5 to 10 matches per user request.
// Mirrors `FORM_WINDOW_LENGTH` in leaderboard_view.ts. Function name kept
// as `buildLast5Map` for backward compat — internal cap is now 10.
const FORM_WINDOW_LENGTH = 10;

/**
 * Pull recent confirmed results for every player in the season, return
 * a 0-3 form array (most recent first) per player. Stops at length
 * `FORM_WINDOW_LENGTH` (10 as of 2026-05-10).
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
  if (arr.length >= FORM_WINDOW_LENGTH) return;
  arr.push(pts);
  map.set(pid, arr);
}
