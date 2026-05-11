import type { SupabaseClient } from "@supabase/supabase-js";
import { REALTIME } from "./registry";
import { gamerTagToSlug } from "@/lib/player-photos";

/**
 * Combined data feed for cover-up overlays (21, 23, 24, 25, 29).
 *
 * One DB roundtrip computes: current win streaks, org standings, biggest
 * margin fixtures, goalfest fixtures, and a rotating "did you know" stat
 * card. Each overlay's HTML `update()` reads its slice from the shared
 * payload.
 *
 * Realtime: any of `standings.changed`, `match.ended`, `score.changed`
 * triggers a re-fetch (subscribed in OverlayDataInjector).
 */

export type CoverUpPlayer = {
  playerId: string;
  displayName: string;
  slug: string;
  photoUrl: string | null;
  orgName: string | null;
  orgLogoUrl: string | null;
};

export type StreakRow = CoverUpPlayer & { streak: number };
export type FixtureRow = {
  home: string;
  away: string;
  homeSlug: string;
  awaySlug: string;
  homeScore: number;
  awayScore: number;
  margin: number;
  total: number;
  date: string;
};
export type OrgRow = {
  orgId: string;
  name: string;
  logoUrl: string | null;
  totalPoints: number;
  totalGd: number;
  totalWins: number;
  totalDraws: number;
  totalLosses: number;
  playerCount: number;
  topPlayer: { name: string; pts: number } | null;
  roster: string[];
};
export type DidYouKnowFact = {
  kind: "top_scorer" | "biggest_gd" | "longest_streak" | "biggest_win" | "goalfest";
  headline: string;
  detail: string;
  player: CoverUpPlayer | null;
};

export type PunditryQuote = {
  text: string;
  author: string;
  role: string;
  /** Player whose photo should sit beside the quote. Falls back to didYouKnow.player. */
  player: CoverUpPlayer | null;
};

export type CoverUpStatsPayload = {
  streaks: StreakRow[];
  orgs: OrgRow[];
  biggestMargins: FixtureRow[];
  goalfests: FixtureRow[];
  didYouKnow: DidYouKnowFact | null;
  punditryQuote: PunditryQuote | null;
};

export type CoverUpStatsResult = {
  seasonId: string;
  channel: string;
  payload: CoverUpStatsPayload;
};

type PlayerJoin = {
  id: string;
  gamer_tag: string | null;
  photo_url: string | null;
  organization_id: string | null;
  users: { display_name: string | null } | { display_name: string | null }[] | null;
  organizations: { name: string; logo_url: string | null } | { name: string; logo_url: string | null }[] | null;
};

type ResultJoin = {
  id: string;
  home_score: number;
  away_score: number;
  winner_player_id: string | null;
  confirmed_at: string | null;
  match:
    | {
        id: string;
        season_id: string;
        scheduled_time: string | null;
        home_player_id: string;
        away_player_id: string;
        home: PlayerJoin | null;
        away: PlayerJoin | null;
      }
    | null;
};

type StandingsJoin = {
  player_id: string;
  matches_played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goal_difference: number;
  points: number;
  player: PlayerJoin | null;
};

function firstOf<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function asCoverUpPlayer(p: PlayerJoin | null): CoverUpPlayer | null {
  if (!p) return null;
  const user = firstOf(p.users);
  const org = firstOf(p.organizations);
  const displayName = (user?.display_name || p.gamer_tag || "").trim();
  if (!displayName) return null;
  return {
    playerId: p.id,
    displayName,
    slug: p.gamer_tag ? gamerTagToSlug(p.gamer_tag) : gamerTagToSlug(displayName),
    photoUrl: p.photo_url,
    orgName: org?.name ?? null,
    orgLogoUrl: org?.logo_url ?? null,
  };
}

export async function fetchCoverUpStats(
  sb: SupabaseClient,
  seasonId: string,
): Promise<CoverUpStatsResult> {
  // 1. Recent confirmed results for streaks / margins / goalfests.
  // Pull more than we strictly need (cap 120) so the per-player streak
  // walk can find a long enough history. Filter to season + normal
  // result type (drop voids).
  const { data: resultsRaw } = await sb
    .from("match_results")
    .select(
      `
      id, home_score, away_score, winner_player_id, confirmed_at,
      match:match_id (
        id, season_id, scheduled_time, home_player_id, away_player_id,
        home:home_player_id (
          id, gamer_tag, photo_url, organization_id,
          users:user_id ( display_name ),
          organizations:organization_id ( name, logo_url )
        ),
        away:away_player_id (
          id, gamer_tag, photo_url, organization_id,
          users:user_id ( display_name ),
          organizations:organization_id ( name, logo_url )
        )
      )
      `,
    )
    .eq("result_type", "normal")
    .is("deleted_at", null)
    .order("confirmed_at", { ascending: false })
    .limit(120);

  const results: ResultJoin[] = ((resultsRaw ?? []) as unknown as ResultJoin[]).filter(
    (r) => r.match?.season_id === seasonId,
  );

  // 2. Streaks — walk each player's results newest-first, count
  // consecutive wins until first non-win.
  const streakProgress = new Map<
    string,
    { player: CoverUpPlayer; streak: number; broken: boolean }
  >();
  for (const r of results) {
    if (!r.match) continue;
    for (const side of [r.match.home, r.match.away] as Array<PlayerJoin | null>) {
      const cup = asCoverUpPlayer(side);
      if (!cup) continue;
      const entry =
        streakProgress.get(cup.playerId) ??
        { player: cup, streak: 0, broken: false };
      if (entry.broken) {
        streakProgress.set(cup.playerId, entry);
        continue;
      }
      const won = r.winner_player_id === cup.playerId;
      if (won) {
        entry.streak += 1;
      } else {
        entry.broken = true;
      }
      streakProgress.set(cup.playerId, entry);
    }
  }
  const streaks: StreakRow[] = Array.from(streakProgress.values())
    .filter((e) => e.streak > 0)
    .map((e) => ({ ...e.player, streak: e.streak }))
    .sort((a, b) => b.streak - a.streak)
    .slice(0, 8);

  // 3. Biggest margins + goalfests over the recent window.
  const fixtures: FixtureRow[] = results
    .map((r): FixtureRow | null => {
      if (!r.match) return null;
      const home = asCoverUpPlayer(r.match.home);
      const away = asCoverUpPlayer(r.match.away);
      if (!home || !away) return null;
      const homeScore = r.home_score ?? 0;
      const awayScore = r.away_score ?? 0;
      return {
        home: home.displayName,
        away: away.displayName,
        homeSlug: home.slug,
        awaySlug: away.slug,
        homeScore,
        awayScore,
        margin: Math.abs(homeScore - awayScore),
        total: homeScore + awayScore,
        date: (r.confirmed_at ?? r.match.scheduled_time ?? "").slice(0, 10),
      };
    })
    .filter((f): f is FixtureRow => f !== null);

  const biggestMargins = [...fixtures]
    .sort((a, b) => b.margin - a.margin || b.total - a.total)
    .slice(0, 6);
  const goalfests = fixtures
    .filter((f) => f.total >= 7)
    .sort((a, b) => b.total - a.total || b.margin - a.margin)
    .slice(0, 6);

  // 4. Org standings — aggregate the live standings table by
  // players.organization_id. Skips players with no org assignment.
  const { data: stRaw } = await sb
    .from("standings")
    .select(
      `
      player_id, matches_played, wins, draws, losses,
      goals_for, goal_difference, points,
      player:player_id (
        id, gamer_tag, photo_url, organization_id,
        users:user_id ( display_name ),
        organizations:organization_id ( name, logo_url )
      )
      `,
    )
    .eq("season_id", seasonId)
    .is("deleted_at", null);
  const stRows: StandingsJoin[] = (stRaw ?? []) as unknown as StandingsJoin[];

  const orgAccum = new Map<string, OrgRow>();
  for (const s of stRows) {
    const cup = asCoverUpPlayer(s.player);
    if (!cup || !s.player?.organization_id) continue;
    const orgId = s.player.organization_id;
    const entry =
      orgAccum.get(orgId) ??
      {
        orgId,
        name: cup.orgName ?? "Unknown",
        logoUrl: cup.orgLogoUrl ?? null,
        totalPoints: 0,
        totalGd: 0,
        totalWins: 0,
        totalDraws: 0,
        totalLosses: 0,
        playerCount: 0,
        topPlayer: null,
        roster: [] as string[],
      };
    entry.totalPoints += s.points ?? 0;
    entry.totalGd += s.goal_difference ?? 0;
    entry.totalWins += s.wins ?? 0;
    entry.totalDraws += s.draws ?? 0;
    entry.totalLosses += s.losses ?? 0;
    entry.playerCount += 1;
    entry.roster.push(cup.displayName);
    if (!entry.topPlayer || (s.points ?? 0) > entry.topPlayer.pts) {
      entry.topPlayer = { name: cup.displayName, pts: s.points ?? 0 };
    }
    orgAccum.set(orgId, entry);
  }
  const orgs = Array.from(orgAccum.values()).sort(
    (a, b) => b.totalPoints - a.totalPoints || b.totalGd - a.totalGd,
  );

  // Helper — resolve a player by display-name match from the standings
  // join. Used to fill `player` for biggest_win / goalfest didYouKnow
  // variants so the 25-did-you-know overlay always has a photo to bind.
  const playerByName = (name: string): CoverUpPlayer | null => {
    const target = name.toLowerCase().trim();
    for (const s of stRows) {
      const cup = asCoverUpPlayer(s.player);
      if (cup && cup.displayName.toLowerCase().trim() === target) return cup;
    }
    return null;
  };

  // 5. Did You Know — pick the most interesting season-wide fact.
  // Priority: longest streak >= 3, then biggest win, then highest scorer.
  let didYouKnow: DidYouKnowFact | null = null;
  if (streaks[0] && streaks[0].streak >= 3) {
    didYouKnow = {
      kind: "longest_streak",
      headline: `${streaks[0].streak} STRAIGHT WINS`,
      detail: `${streaks[0].displayName.toUpperCase()} is on a ${streaks[0].streak}-match winning run — the longest active streak in Elite Season 2.`,
      player: streaks[0],
    };
  } else if (biggestMargins[0] && biggestMargins[0].margin >= 4) {
    const m = biggestMargins[0];
    const winnerName = m.homeScore > m.awayScore ? m.home : m.away;
    const loserName = m.homeScore > m.awayScore ? m.away : m.home;
    didYouKnow = {
      kind: "biggest_win",
      headline: `${m.margin}-GOAL THRASHING`,
      detail: `${winnerName.toUpperCase()} beat ${loserName.toUpperCase()} ${m.homeScore}-${m.awayScore} on ${m.date} — the widest margin of the season so far.`,
      player: playerByName(winnerName),
    };
  } else {
    // Highest scorer fall-through — pull top GF from standings.
    const topScorerRow = [...stRows].sort((a, b) => (b.goals_for ?? 0) - (a.goals_for ?? 0))[0];
    if (topScorerRow) {
      const cup = asCoverUpPlayer(topScorerRow.player);
      if (cup) {
        didYouKnow = {
          kind: "top_scorer",
          headline: `${topScorerRow.goals_for} GOALS SCORED`,
          detail: `${cup.displayName.toUpperCase()} leads the league in goals with ${topScorerRow.goals_for} across ${topScorerRow.matches_played} matches.`,
          player: cup,
        };
      }
    }
  }

  // 6. Punditry quote — rotate by week-of-year so the same payload
  // doesn't always pick the same angle. Server-built from live stats
  // so the broadcast never reads stale "Guru jumped 4 spots" text
  // when the underlying numbers have moved on.
  const wk = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const angles: PunditryQuote[] = [];
  if (streaks[0] && streaks[0].streak >= 2) {
    angles.push({
      text: `${streaks[0].displayName.toUpperCase()} ON A ${streaks[0].streak}-MATCH WINNING RUN — THE STORY OF THE WEEK.`,
      author: "CADE PUNDIT DESK",
      role: "FORM TRACKER",
      player: streaks[0],
    });
  }
  if (biggestMargins[0]) {
    const m = biggestMargins[0];
    const winner = m.homeScore > m.awayScore ? m.home : m.away;
    angles.push({
      text: `${winner.toUpperCase()} JUST PUT ${m.margin} GOALS PAST ${(m.homeScore > m.awayScore ? m.away : m.home).toUpperCase()} — STATEMENT WIN OF THE SEASON.`,
      author: "CADE PUNDIT DESK",
      role: "RESULT OF THE WEEK",
      player: playerByName(winner),
    });
  }
  if (goalfests[0]) {
    const g = goalfests[0];
    angles.push({
      text: `${g.total} GOALS BETWEEN ${g.home.toUpperCase()} AND ${g.away.toUpperCase()} — THE MOST ELECTRIC NIGHT OF THE SEASON.`,
      author: "CADE PUNDIT DESK",
      role: "GOALFEST OF THE WEEK",
      player: playerByName(g.homeScore > g.awayScore ? g.home : g.away),
    });
  }
  if (orgs[0] && orgs[0].topPlayer) {
    angles.push({
      text: `${orgs[0].name.toUpperCase()} DOMINATING THE ORG TABLE — ${orgs[0].totalPoints} POINTS COMBINED, ${orgs[0].roster.map((n) => n.toUpperCase()).join(" + ")} CARRYING.`,
      author: "CADE PUNDIT DESK",
      role: "ORG WATCH",
      player: playerByName(orgs[0].topPlayer.name),
    });
  }
  const punditryQuote: PunditryQuote | null =
    angles.length > 0 ? angles[wk % angles.length] : null;

  return {
    seasonId,
    channel: REALTIME.standingsChannel(seasonId),
    payload: { streaks, orgs, biggestMargins, goalfests, didYouKnow, punditryQuote },
  };
}
