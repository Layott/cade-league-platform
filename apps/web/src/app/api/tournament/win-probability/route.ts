import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { hasPermAsync } from "@/lib/perms-db";
import { getActiveSeason } from "@/server/seasons";
import { loadLeaderboard } from "@/server/standings/leaderboard_view";
import {
  computeWinProbability,
  formStrength,
  h2hStrength,
  seasonStrength,
  type H2HRecord,
  type PlayerSeasonStats,
} from "@/server/standings/win_probability";

/**
 * Plan 51 — GET /api/tournament/win-probability?a=<id>&b=<id>
 *
 * Returns the win-probability triple plus the per-component breakdown so
 * the calculator UI can show the formula at work.
 */

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

export async function GET(req: NextRequest) {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  const svc = getServiceRoleSupabase();
  const ok = await hasPermAsync(svc, { userId: pub.id, roles }, "tournament.read");
  if (!ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const a = req.nextUrl.searchParams.get("a") ?? "";
  const b = req.nextUrl.searchParams.get("b") ?? "";
  try {
    idSchema.parse(a);
    idSchema.parse(b);
  } catch {
    return NextResponse.json({ error: "a and b must be UUIDs" }, { status: 400 });
  }
  if (a === b) {
    return NextResponse.json({ error: "a and b must differ" }, { status: 400 });
  }

  const season = await getActiveSeason(svc);
  if (!season) {
    return NextResponse.json({ error: "no active season" }, { status: 404 });
  }

  const leaderboard = await loadLeaderboard(svc, season.id);
  const aRow = leaderboard.find((r) => r.playerId === a);
  const bRow = leaderboard.find((r) => r.playerId === b);
  if (!aRow || !bRow) {
    return NextResponse.json(
      { error: "player(s) not found in active season standings" },
      { status: 404 },
    );
  }

  // Build last5 form arrays from match_results.
  const last5Map = await loadLast5(svc, season.id);

  const aStats: PlayerSeasonStats = {
    played: aRow.played,
    wins: aRow.wins,
    draws: aRow.draws,
    losses: aRow.losses,
    gf: aRow.gf,
    ga: aRow.ga,
    gd: aRow.gd,
    points: aRow.pts,
    last5Form: last5Map.get(a) ?? [],
  };
  const bStats: PlayerSeasonStats = {
    played: bRow.played,
    wins: bRow.wins,
    draws: bRow.draws,
    losses: bRow.losses,
    gf: bRow.gf,
    ga: bRow.ga,
    gd: bRow.gd,
    points: bRow.pts,
    last5Form: last5Map.get(b) ?? [],
  };

  const h2h = await loadH2HRecord(svc, season.id, a, b);
  const wp = computeWinProbability(aStats, bStats, h2h);

  return NextResponse.json(
    {
      a: { id: a, name: aRow.name, gamerTag: aRow.gamerTag },
      b: { id: b, name: bRow.name, gamerTag: bRow.gamerTag },
      breakdown: {
        h2hScoreA: h2h ? h2hStrength(h2h) : null,
        seasonScoreA: seasonStrength(aStats),
        last5ScoreA: formStrength(aStats),
        seasonScoreB: seasonStrength(bStats),
        last5ScoreB: formStrength(bStats),
        weights: { h2h: 0.4, season: 0.4, last5: 0.2 },
        h2hRecord: h2h,
      },
      probability: wp,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function loadLast5(
  sb: ReturnType<typeof getServiceRoleSupabase>,
  seasonId: string,
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  const { data } = await sb
    .from("match_results")
    .select(
      `
      home_score, away_score, result_type,
      match:match_id ( home_player_id, away_player_id, season_id )
      `,
    )
    .is("deleted_at", null)
    .neq("result_type", "void")
    .order("created_at", { ascending: false })
    .limit(500);

  type Row = {
    home_score: number;
    away_score: number;
    match: {
      home_player_id: string;
      away_player_id: string;
      season_id: string;
    } | null;
  };
  for (const r of (data ?? []) as unknown as Row[]) {
    if (!r.match || r.match.season_id !== seasonId) continue;
    const home = r.match.home_player_id;
    const away = r.match.away_player_id;
    let homePts = 0;
    let awayPts = 0;
    if (r.home_score > r.away_score) {
      homePts = 3;
    } else if (r.home_score < r.away_score) {
      awayPts = 3;
    } else {
      homePts = 1;
      awayPts = 1;
    }
    push5(out, home, homePts);
    push5(out, away, awayPts);
  }
  return out;
}

function push5(map: Map<string, number[]>, pid: string, pts: number) {
  const arr = map.get(pid) ?? [];
  if (arr.length >= 5) return;
  arr.push(pts);
  map.set(pid, arr);
}

async function loadH2HRecord(
  sb: ReturnType<typeof getServiceRoleSupabase>,
  seasonId: string,
  aId: string,
  bId: string,
): Promise<H2HRecord | undefined> {
  const { data } = await sb
    .from("match_results")
    .select(
      `
      home_score, away_score, result_type,
      match:match_id ( home_player_id, away_player_id, season_id )
      `,
    )
    .is("deleted_at", null)
    .neq("result_type", "void");
  type Row = {
    home_score: number;
    away_score: number;
    match: {
      home_player_id: string;
      away_player_id: string;
      season_id: string;
    } | null;
  };
  let total = 0;
  let aWins = 0;
  let bWins = 0;
  let draws = 0;
  for (const r of (data ?? []) as unknown as Row[]) {
    if (!r.match || r.match.season_id !== seasonId) continue;
    const home = r.match.home_player_id;
    const away = r.match.away_player_id;
    if (!((home === aId && away === bId) || (home === bId && away === aId))) continue;
    total += 1;
    if (r.home_score === r.away_score) {
      draws += 1;
      continue;
    }
    const homeWin = r.home_score > r.away_score;
    if ((homeWin && home === aId) || (!homeWin && away === aId)) {
      aWins += 1;
    } else {
      bWins += 1;
    }
  }
  if (total === 0) return undefined;
  return { totalMatches: total, aWins, bWins, draws };
}
