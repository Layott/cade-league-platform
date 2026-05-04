/**
 * Plan 54 — per-template data fetchers.
 *
 * Each fetcher resolves a broadcast session to a season + match-day, then
 * delegates to the existing per-overlay readers under
 * `apps/web/src/server/overlays/`. Reusing those readers keeps the social
 * card payload bit-identical to what the live overlay shows — there is no
 * second source of truth.
 *
 * Wave 1C (this file) only ships the data layer. The OG components (Wave 1B)
 * + admin tiles (Wave 2) consume these payloads. The shapes are deliberately
 * shallow (flat row arrays + scalar headers) so `next/og` JSX maps over them
 * without nested helpers.
 *
 * `size` is accepted as a parameter for future per-size payload trimming
 * (e.g. 1080×675 X cards may want 5 rows vs 13 on portrait); no fetcher uses
 * it today but the parameter shape is locked so adding the trim later doesn't
 * break callers.
 *
 * Spec: docs/superpowers/specs/2026-05-05-broadcast-social-media.md §4 + §6.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchLeaderboardData } from "@/server/overlays/leaderboard_data";
import { fetchTopScorersData } from "@/server/overlays/top_scorers_data";
import { fetchMatchScoresDayDataBySession } from "@/server/overlays/match_scores_day_data";
import { formatWat } from "@/lib/time";
import type { SocialSize } from "@/lib/social-sizes";

/* ------------------------------------------------------------------ *
 * Shared helper — session → match_day → season                       *
 * ------------------------------------------------------------------ */

type SessionResolution = {
  sessionId: string;
  matchDayId: string;
  seasonId: string;
  matchDate: string | null;
};

/**
 * Resolve a `stream_sessions.id` to its match_day + season. Throws when the
 * session is not found or has been soft-deleted — social-asset rendering can
 * only proceed against a real, live session row.
 */
async function resolveSession(
  sb: SupabaseClient,
  sessionId: string,
): Promise<SessionResolution> {
  const { data: sessRaw, error: sessErr } = await sb
    .from("stream_sessions")
    .select("id, match_day_id")
    .eq("id", sessionId)
    .is("deleted_at", null)
    .maybeSingle();
  if (sessErr) {
    throw new Error(`resolveSession failed: ${sessErr.message}`);
  }
  if (!sessRaw) {
    throw new Error(`session ${sessionId} not found`);
  }
  const sess = sessRaw as { id: string; match_day_id: string };

  const { data: mdRaw, error: mdErr } = await sb
    .from("match_days")
    .select("id, season_id, match_date")
    .eq("id", sess.match_day_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (mdErr) {
    throw new Error(`resolveSession match_day failed: ${mdErr.message}`);
  }
  if (!mdRaw) {
    throw new Error(`match_day ${sess.match_day_id} not found`);
  }
  const md = mdRaw as {
    id: string;
    season_id: string;
    match_date: string | null;
  };

  return {
    sessionId: sess.id,
    matchDayId: md.id,
    seasonId: md.season_id,
    matchDate: md.match_date,
  };
}

/**
 * Format a YYYY-MM-DD into `Sunday May 4th, 2026` style for the asset header.
 * Falls back to "Latest" when the match day has no date set yet.
 */
function formatWeekLabel(matchDate: string | null): string {
  if (!matchDate) return "Latest";
  // formatWat takes a Date|string instant. Anchor the calendar date to UTC
  // midnight so date-fns-tz formats it as the SAME civil date in Africa/Lagos
  // (no DST shift to worry about). No-suffix variant — `do` emits "4th".
  const iso = `${matchDate}T00:00:00Z`;
  return formatWat(iso, "EEEE MMMM do, yyyy");
}

/* ------------------------------------------------------------------ *
 * Leaderboard                                                         *
 * ------------------------------------------------------------------ */

export interface LeaderboardRow {
  pos: number;
  name: string;
  slug: string;
  mp: number;
  w: number;
  l: number;
  d: number;
  g: number;
  gd: number;
  pts: number;
  /** Optional resolved photo URL — null when no slug-derived asset exists. */
  photoUrl: string | null;
  /**
   * Animated-reel hint: this row's position + points one week ago. Only set
   * when the most recent prior leaderboard_snapshot for the same season has
   * the player. Both fields move as a pair.
   */
  w1Pos?: number;
  w1Pts?: number;
}

export interface LeaderboardPayload {
  seasonId: string;
  matchDayId: string;
  /** Header label shown on the asset, e.g. "Sunday May 4th, 2026". */
  weekLabel: string;
  rows: LeaderboardRow[];
}

/**
 * Fetch + shape the leaderboard payload for a given session. `size` is
 * accepted but not yet branched on — every preset sees the full top-13.
 */
export async function fetchLeaderboardPayload(
  sb: SupabaseClient,
  sessionId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for size-specific row trimming in Phase 2
  _size?: SocialSize,
): Promise<LeaderboardPayload> {
  const session = await resolveSession(sb, sessionId);
  const data = await fetchLeaderboardData(sb, session.seasonId, 13);

  const rows: LeaderboardRow[] = data.rows.map((r) => ({
    pos: r.rank,
    name: r.player_name,
    slug: r.slug ?? "",
    mp: r.matches_played,
    w: r.wins,
    l: r.losses,
    d: r.draws,
    g: r.goals_for,
    gd: r.goal_difference,
    pts: r.points,
    photoUrl: r.photo_url,
  }));

  // Best-effort enrichment: read the most recent prior leaderboard_snapshot
  // and stamp w1Pos/w1Pts onto matching player rows. Snapshot misses are
  // silent — the OG component degrades to no-trend state.
  await enrichWithPriorSnapshot(sb, session, rows);

  return {
    seasonId: session.seasonId,
    matchDayId: session.matchDayId,
    weekLabel: formatWeekLabel(session.matchDate),
    rows,
  };
}

/**
 * Stamp `w1Pos` / `w1Pts` on each row from the most recent prior snapshot
 * (i.e. the one captured at the previous match day). Mutates `rows` in
 * place. Failures are swallowed: missing snapshot = no trend hints, the
 * card still renders.
 */
async function enrichWithPriorSnapshot(
  sb: SupabaseClient,
  session: SessionResolution,
  rows: LeaderboardRow[],
): Promise<void> {
  type SnapshotRow = {
    match_day_id: string;
    snapshot_data: unknown;
    captured_at: string;
  };
  const { data, error } = await sb
    .from("leaderboard_snapshots")
    .select("match_day_id, snapshot_data, captured_at")
    .order("captured_at", { ascending: false })
    .limit(50);
  if (error || !Array.isArray(data)) return;
  const snapshots = data as SnapshotRow[];

  // Find the first snapshot that (a) belongs to a different match-day than
  // this session's and (b) is for the same season. The `snapshot_data` payload
  // shape is `{ season_id, rows: StandingsRow[] }` (see snapshots.ts §3).
  const prior = snapshots.find((s) => {
    if (s.match_day_id === session.matchDayId) return false;
    const payload = s.snapshot_data as
      | { season_id?: string; rows?: unknown[] }
      | null;
    return payload?.season_id === session.seasonId && Array.isArray(payload.rows);
  });
  if (!prior) return;

  const payload = prior.snapshot_data as {
    rows: Array<{
      player_id?: string;
      points?: number;
      goal_difference?: number;
      goals_for?: number;
    }>;
  };
  // Reproduce the live sort tiebreak so the prior-week position is
  // consistent with how `standings` orders rows.
  const sortedPrior = [...payload.rows].sort((a, b) => {
    if ((b.points ?? 0) !== (a.points ?? 0)) {
      return (b.points ?? 0) - (a.points ?? 0);
    }
    if ((b.goal_difference ?? 0) !== (a.goal_difference ?? 0)) {
      return (b.goal_difference ?? 0) - (a.goal_difference ?? 0);
    }
    return (b.goals_for ?? 0) - (a.goals_for ?? 0);
  });

  // The live row list carries the slug-or-tag but not the player_id. The
  // snapshot keys by player_id. We re-key by joining against the live
  // `data.rows[i].player_id` (the parent caller has it on the Db row but
  // strips it during shape mapping). To keep the pure shape mapping clean,
  // accept that this enrichment uses the raw rows array — when the live row
  // has no slug we skip it (matches w1Pos enrichment intent: "trend hint, not
  // load-bearing").
  //
  // Practical approach: build a player_id → priorPos/priorPts index, then
  // fall back to a slug-name match against the live row list as a defensive
  // path when player_id is absent.
  const priorByPid = new Map<string, { pos: number; pts: number }>();
  for (let i = 0; i < sortedPrior.length; i++) {
    const sr = sortedPrior[i];
    if (sr.player_id) {
      priorByPid.set(sr.player_id, { pos: i + 1, pts: sr.points ?? 0 });
    }
  }

  // Re-fetch live `standings` rows for player_id mapping. This is one extra
  // round-trip but keeps the enrichment side-effect-free at the shape layer.
  const { data: liveData } = await sb
    .from("standings")
    .select("player_id, player:player_id ( gamer_tag )")
    .eq("season_id", session.seasonId)
    .is("deleted_at", null);
  if (!Array.isArray(liveData)) return;
  type LiveRow = {
    player_id: string;
    player: { gamer_tag: string | null } | null;
  };
  const liveByTag = new Map<string, string>();
  for (const lr of liveData as unknown as LiveRow[]) {
    const tag = lr.player?.gamer_tag ?? "";
    if (tag) liveByTag.set(tag, lr.player_id);
  }

  for (const row of rows) {
    const pid = liveByTag.get(row.slug) ?? "";
    if (!pid) continue;
    const prev = priorByPid.get(pid);
    if (!prev) continue;
    row.w1Pos = prev.pos;
    row.w1Pts = prev.pts;
  }
}

/* ------------------------------------------------------------------ *
 * Top scorers                                                         *
 * ------------------------------------------------------------------ */

export interface TopScorerRow {
  pos: number;
  name: string;
  slug: string;
  goals: number;
  photoUrl: string | null;
}

export interface TopScorersPayload {
  seasonId: string;
  matchDayId: string;
  weekLabel: string;
  rows: TopScorerRow[];
}

/**
 * Top 10 scorers for the session's season. Empty `rows` when no goals on
 * record yet — the OG component renders a "NO SCORERS YET" stub.
 */
export async function fetchTopScorersPayload(
  sb: SupabaseClient,
  sessionId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _size?: SocialSize,
): Promise<TopScorersPayload> {
  const session = await resolveSession(sb, sessionId);
  const data = await fetchTopScorersData(sb, session.seasonId, 10);

  const rows: TopScorerRow[] = data.rows.map((r) => ({
    pos: r.rank,
    name: r.player_name,
    slug: r.gamer_tag ?? "",
    goals: r.goals,
    photoUrl: r.photo_url,
  }));

  return {
    seasonId: session.seasonId,
    matchDayId: session.matchDayId,
    weekLabel: formatWeekLabel(session.matchDate),
    rows,
  };
}

/* ------------------------------------------------------------------ *
 * Upcoming fixtures                                                   *
 * ------------------------------------------------------------------ */

export interface FixtureRow {
  matchId: string;
  home: string;
  away: string;
  homeSlug: string;
  awaySlug: string;
  homePhotoUrl: string | null;
  awayPhotoUrl: string | null;
  scheduledTime: string | null;
  /** "scheduled" | "in_progress" | "completed" — same enum as overlay. */
  status: "scheduled" | "in_progress" | "completed";
}

export interface FixturesPayload {
  seasonId: string;
  matchDayId: string;
  /** Header label e.g. "Match Day 5 — Sun May 4". */
  weekLabel: string;
  rows: FixtureRow[];
}

/**
 * The next match-day's slate for the session's broadcast. Reuses
 * `fetchMatchScoresDayDataBySession` so the row shape stays bit-identical
 * to the on-air match-scores-day overlay.
 *
 * Throws when the session resolves to a match-day with no fixtures (rare —
 * a match-day is created with its 6/7 round-robin matches; this is a
 * defensive guard against a misconfigured session).
 */
export async function fetchUpcomingFixturesPayload(
  sb: SupabaseClient,
  sessionId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _size?: SocialSize,
): Promise<FixturesPayload> {
  const data = await fetchMatchScoresDayDataBySession(sb, sessionId);
  if (!data) {
    throw new Error(
      `fetchUpcomingFixturesPayload: session ${sessionId} not found`,
    );
  }

  const rows: FixtureRow[] = data.rows.map((r) => ({
    matchId: r.match_id,
    home: r.home,
    away: r.away,
    homeSlug: r.home_slug,
    awaySlug: r.away_slug,
    homePhotoUrl: r.home_photo_url,
    awayPhotoUrl: r.away_photo_url,
    scheduledTime: r.scheduled_time,
    status: r.status,
  }));

  return {
    seasonId: data.seasonId ?? "",
    matchDayId: data.matchDayId,
    weekLabel: data.label,
    rows,
  };
}

/* ------------------------------------------------------------------ *
 * Goal-difference leaders                                             *
 * ------------------------------------------------------------------ */

export interface GdLeaderRow {
  pos: number;
  name: string;
  slug: string;
  gd: number;
  gf: number;
  ga: number;
  photoUrl: string | null;
}

export interface GdLeadersPayload {
  seasonId: string;
  matchDayId: string;
  weekLabel: string;
  rows: GdLeaderRow[];
}

/**
 * Top 5 by goal difference, derived from the leaderboard payload.
 * Tiebreak: GF desc, then name asc — same hierarchy `standings` uses.
 */
export async function fetchGdLeadersPayload(
  sb: SupabaseClient,
  sessionId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _size?: SocialSize,
): Promise<GdLeadersPayload> {
  const session = await resolveSession(sb, sessionId);
  const data = await fetchLeaderboardData(sb, session.seasonId, 13);

  const sorted = [...data.rows].sort((a, b) => {
    if (b.goal_difference !== a.goal_difference) {
      return b.goal_difference - a.goal_difference;
    }
    if (b.goals_for !== a.goals_for) return b.goals_for - a.goals_for;
    return a.player_name.localeCompare(b.player_name);
  });

  const rows: GdLeaderRow[] = sorted.slice(0, 5).map((r, i) => ({
    pos: i + 1,
    name: r.player_name,
    slug: r.slug ?? "",
    gd: r.goal_difference,
    gf: r.goals_for,
    ga: r.goals_against,
    photoUrl: r.photo_url,
  }));

  return {
    seasonId: session.seasonId,
    matchDayId: session.matchDayId,
    weekLabel: formatWeekLabel(session.matchDate),
    rows,
  };
}

/* ------------------------------------------------------------------ *
 * League average stats                                                *
 * ------------------------------------------------------------------ */

export interface LeagueAvgPayload {
  seasonId: string;
  matchDayId: string;
  weekLabel: string;
  /** Number of players the averages were computed across. */
  playerCount: number;
  /** Per-stat averages, rounded to 1 decimal. */
  avg: {
    matchesPlayed: number;
    wins: number;
    draws: number;
    losses: number;
    goalsFor: number;
    goalsAgainst: number;
    goalDifference: number;
    points: number;
  };
  /**
   * Aggregate totals — sometimes more useful than averages on the card
   * (e.g. "78 goals across 39 matches"). Populated regardless.
   */
  total: {
    matches: number;
    goalsFor: number;
    goalsAgainst: number;
  };
}

/**
 * Compute league-wide averages from the leaderboard rows. `playerCount = 0`
 * indicates a fresh season (no participants yet) — the OG component renders
 * a "STATS POSTED AFTER FIRST MATCH" placeholder in that case.
 */
export async function fetchLeagueAvgPayload(
  sb: SupabaseClient,
  sessionId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _size?: SocialSize,
): Promise<LeagueAvgPayload> {
  const session = await resolveSession(sb, sessionId);
  const data = await fetchLeaderboardData(sb, session.seasonId, 13);

  const n = data.rows.length;
  if (n === 0) {
    return {
      seasonId: session.seasonId,
      matchDayId: session.matchDayId,
      weekLabel: formatWeekLabel(session.matchDate),
      playerCount: 0,
      avg: {
        matchesPlayed: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        points: 0,
      },
      total: { matches: 0, goalsFor: 0, goalsAgainst: 0 },
    };
  }

  // Each match counts twice in the standings (once for each side). Divide by
  // two when reporting "matches" as a league total to avoid double-counting.
  let mp = 0;
  let w = 0;
  let d = 0;
  let l = 0;
  let gf = 0;
  let ga = 0;
  let gdSum = 0;
  let pts = 0;
  for (const r of data.rows) {
    mp += r.matches_played;
    w += r.wins;
    d += r.draws;
    l += r.losses;
    gf += r.goals_for;
    ga += r.goals_against;
    gdSum += r.goal_difference;
    pts += r.points;
  }

  const round1 = (x: number): number => Math.round(x * 10) / 10;

  return {
    seasonId: session.seasonId,
    matchDayId: session.matchDayId,
    weekLabel: formatWeekLabel(session.matchDate),
    playerCount: n,
    avg: {
      matchesPlayed: round1(mp / n),
      wins: round1(w / n),
      draws: round1(d / n),
      losses: round1(l / n),
      goalsFor: round1(gf / n),
      goalsAgainst: round1(ga / n),
      goalDifference: round1(gdSum / n),
      points: round1(pts / n),
    },
    total: {
      // `mp` is per-side; halve to recover unique-match count. Round to int.
      matches: Math.round(mp / 2),
      goalsFor: gf,
      goalsAgainst: ga,
    },
  };
}
