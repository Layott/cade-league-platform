import type { SupabaseClient } from "@supabase/supabase-js";
import { REALTIME } from "./registry";
import { topScorersSchema, type TopScorersPayload } from "./schemas";
import { gamerTagToSlug } from "@/lib/player-photos";
import { resolvePlayerPose } from "./player-photos/resolver";
import {
  buildPhotoUrl,
  getVariantKindForOverlay,
} from "./player-photos/variant-map";

/**
 * Audit Slice 1 (2026-04-24) — server reader for the `/overlay/top-scorers`
 * overlay ("Golden Pad").
 *
 * Data source strategy
 * --------------------
 * This overlay needs per-player goal totals — something `public.standings`
 * does NOT store (it only tracks team-level goals_for). Three sources
 * stack in priority order:
 *
 *   1. `public.goal_events` (new in migration `20260517000100`) — per-goal
 *      attribution with `own_goal` flag. Authoritative once score-entry
 *      lands per-goal attribution (see header of that migration).
 *   2. `public.player_match_stats.goals` — per-player per-match aggregate
 *      that the Plan 14 OCR pipeline writes into. Populated for
 *      screenshot-ingested matches.
 *   3. **Bug-2 fix (2026-04-29)** — fallback to `match_results.home_score`
 *      / `away_score` attributed to whoever played that side of the
 *      match. The score-entry flow writes only `home_score` /
 *      `away_score` (no per-player goal rows yet), so without this
 *      fallback the overlay was always empty even though the season had
 *      10 confirmed matches with 50+ goals scored. The fallback is
 *      ONLY applied to (player, match) tuples that have NO row in
 *      `goal_events` AND NO row in `player_match_stats` so explicit
 *      per-goal attribution always wins when present.
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
  // Track (player, match) pairs that already have an explicit per-player
  // attribution (goal_events OR player_match_stats) so the match_results
  // fallback below doesn't double-count them.
  const matchIdsWithExplicit = new Map<string, Set<string>>();
  for (const [pid, a] of acc) {
    matchIdsWithExplicit.set(pid, new Set(a.match_ids_with_ge));
  }
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
    // Mark this (player, match) as having explicit per-player data so
    // the match_results fallback skips it.
    let s = matchIdsWithExplicit.get(p.player_id);
    if (!s) {
      s = new Set();
      matchIdsWithExplicit.set(p.player_id, s);
    }
    s.add(p.match_id);
  }

  // Bug-2 fix (2026-04-29) — match_results.home_score/away_score fallback.
  //
  // Today's score-entry flow writes only team-level scores into
  // `match_results` (no `goal_events` rows, no `player_match_stats` rows
  // for those matches). Without a fallback, top-scorers stays frozen at
  // empty even after 10+ confirmed matches because both per-player
  // sources are 0 rows. Attribute home_score to home_player and away_score
  // to away_player ONLY for (player, match) tuples that don't already
  // have explicit per-player data above.
  //
  // Filter mirrors `recompute_standings()`:
  //   - season_id matches via the matches FK
  //   - result_type IN ('normal', 'forfeit')
  //   - walkover_pending IS NULL OR walkover_pending = false
  //   - confirmed_at IS NOT NULL
  //   - deleted_at IS NULL on both match_results AND matches
  const { data: mrData, error: mrErr } = await sb
    .from("match_results")
    .select(
      `
      match_id,
      home_score,
      away_score,
      result_type,
      walkover_pending,
      confirmed_at,
      match:match_id!inner (
        season_id,
        deleted_at,
        home_player_id,
        away_player_id,
        home_player:home_player_id (
          gamer_tag,
          users:users!players_user_id_fkey ( display_name )
        ),
        away_player:away_player_id (
          gamer_tag,
          users:users!players_user_id_fkey ( display_name )
        )
      )
      `,
    )
    .eq("match.season_id", seasonId)
    .is("match.deleted_at", null)
    .is("deleted_at", null)
    .in("result_type", ["normal", "forfeit"])
    .not("confirmed_at", "is", null);

  if (mrErr) {
    throw new Error(`fetchTopScorersData mr fallback failed: ${mrErr.message}`);
  }

  type MrRow = {
    match_id: string;
    home_score: number;
    away_score: number;
    walkover_pending: boolean | null;
    match: {
      home_player_id: string;
      away_player_id: string;
      home_player: {
        gamer_tag: string | null;
        users: { display_name: string | null } | null;
      } | null;
      away_player: {
        gamer_tag: string | null;
        users: { display_name: string | null } | null;
      } | null;
    } | null;
  };
  const rowsMr = (mrData ?? []) as unknown as MrRow[];
  for (const r of rowsMr) {
    if (!r.match) continue;
    if (r.walkover_pending === true) continue;
    const homeId = r.match.home_player_id;
    const awayId = r.match.away_player_id;
    const homePlayerGt = r.match.home_player?.gamer_tag ?? null;
    const awayPlayerGt = r.match.away_player?.gamer_tag ?? null;
    const homePlayerName =
      r.match.home_player?.users?.display_name ?? homePlayerGt ?? "(unknown)";
    const awayPlayerName =
      r.match.away_player?.users?.display_name ?? awayPlayerGt ?? "(unknown)";

    function attribute(
      pid: string,
      gt: string | null,
      name: string,
      goals: number,
    ): void {
      if (!pid || goals <= 0) return;
      const existingExplicit = matchIdsWithExplicit.get(pid);
      // Skip if explicit per-player data already exists for this
      // (player, match) — it's authoritative.
      if (existingExplicit?.has(r.match_id)) return;
      const existing = acc.get(pid);
      if (existing) {
        existing.pms_goals += goals;
      } else {
        acc.set(pid, {
          player_id: pid,
          player_name: name,
          gamer_tag: gt,
          pms_goals: goals,
          ge_goals: 0,
          match_ids_with_ge: new Set(),
        });
      }
    }

    attribute(homeId, homePlayerGt, homePlayerName, r.home_score);
    attribute(awayId, awayPlayerGt, awayPlayerName, r.away_score);
  }

  // Collapse to row + rank, filter 0-goal rows, sort, take top N.
  //
  // Plan 53 (2026-05-04) — photoUrl now flows through `resolvePlayerPose`
  // (consults `player_photo_selections`) + `buildPhotoUrl` so admins can
  // tune the displayed pose per (player, overlay) without code edits.
  // Falls back through legacy DEFAULT_POSE_BY_SLUG / pose 1 inside the
  // resolver when no DB row exists, preserving the prior wire shape.
  const overlayKey = "14-top-scorers";
  const variantKind = getVariantKindForOverlay(overlayKey);
  const collapsedRaw = Array.from(acc.values())
    .map((a) => ({
      player_id: a.player_id,
      player_name: a.player_name,
      gamer_tag: a.gamer_tag,
      goals: a.ge_goals + a.pms_goals,
    }))
    .filter((r) => r.goals > 0)
    .sort((a, b) => {
      if (b.goals !== a.goals) return b.goals - a.goals;
      return a.player_name.localeCompare(b.player_name);
    })
    .slice(0, n);

  const merged: Omit<TopScorerRow, "rank">[] = await Promise.all(
    collapsedRaw.map(async (r) => {
      let photoUrl: string | null = null;
      const slug = r.gamer_tag ? gamerTagToSlug(r.gamer_tag) : "";
      if (slug) {
        const resolved = await resolvePlayerPose(sb, r.player_id, overlayKey, {
          slug,
        });
        photoUrl = buildPhotoUrl({
          slug,
          playerId: r.player_id,
          poseIndex: resolved.poseIndex,
          variantKind,
          source: resolved.source,
        });
      }
      return {
        player_id: r.player_id,
        player_name: r.player_name,
        gamer_tag: r.gamer_tag,
        goals: r.goals,
        photo_url: photoUrl,
      };
    }),
  );

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
