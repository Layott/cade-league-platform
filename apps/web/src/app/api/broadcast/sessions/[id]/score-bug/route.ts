import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { checkViewToken } from "@/server/broadcast/view_token_gate";
import { enforcePublicRead } from "@/lib/api-rate-limit";
import { REALTIME } from "@/server/overlays/registry";
import { gamerTagToSlug } from "@/lib/player-photos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MatchRow = {
  id: string;
  status: string;
  home_player: {
    id: string;
    gamer_tag: string | null;
    photo_url: string | null;
    users: { display_name: string | null } | { display_name: string | null }[] | null;
  } | null;
  away_player: {
    id: string;
    gamer_tag: string | null;
    photo_url: string | null;
    users: { display_name: string | null } | { display_name: string | null }[] | null;
  } | null;
};

type ResultRow = {
  home_score: number;
  away_score: number;
  match_id: string;
};

function firstOf<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

/**
 * Live score-bug feed for 09-secondary-score-bug overlay. Returns the
 * current in-progress match for the session's match-day with home/away
 * names + photos + scores. Falls back to the next scheduled match when
 * nothing is in-progress yet so OBS browser sources never show empty
 * bug at kickoff.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = await enforcePublicRead(req);
  if (limited) return limited;

  const { id } = await params;
  const sb = getServiceRoleSupabase();

  const gate = await checkViewToken(sb, req, id);
  if (!gate.ok) return gate.response;

  const { data: sessRaw } = await sb
    .from("stream_sessions")
    .select("id, match_day_id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!sessRaw) return NextResponse.json({ error: "session not found" }, { status: 404 });
  const sess = sessRaw as { id: string; match_day_id: string };

  const { data: mdRaw } = await sb
    .from("match_days")
    .select("id, season_id")
    .eq("id", sess.match_day_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!mdRaw) return NextResponse.json({ error: "match_day not found" }, { status: 404 });
  const md = mdRaw as { id: string; season_id: string };

  // Pick in_progress match first; fall back to next scheduled.
  const { data: matchesRaw } = await sb
    .from("matches")
    .select(
      `
      id, status,
      home_player:home_player_id (
        id, gamer_tag, photo_url,
        users:users!players_user_id_fkey ( display_name )
      ),
      away_player:away_player_id (
        id, gamer_tag, photo_url,
        users:users!players_user_id_fkey ( display_name )
      )
      `,
    )
    .eq("match_day_id", md.id)
    .is("deleted_at", null)
    .order("scheduled_time", { ascending: true });

  const rows = (matchesRaw ?? []) as unknown as MatchRow[];
  const pick =
    rows.find((r) => r.status === "in_progress") ??
    rows.find((r) => r.status === "scheduled") ??
    rows[0] ??
    null;

  let payload: unknown = null;
  if (pick) {
    let homeScore = 0;
    let awayScore = 0;
    const { data: resRow } = await sb
      .from("match_results")
      .select("home_score, away_score, match_id")
      .eq("match_id", pick.id)
      .is("deleted_at", null)
      .order("entered_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const res = resRow as ResultRow | null;
    if (res) {
      homeScore = res.home_score ?? 0;
      awayScore = res.away_score ?? 0;
    }

    const home = pick.home_player;
    const away = pick.away_player;
    const homeUser = firstOf(home?.users ?? null);
    const awayUser = firstOf(away?.users ?? null);
    const homeName = homeUser?.display_name || home?.gamer_tag || "";
    const awayName = awayUser?.display_name || away?.gamer_tag || "";
    const homeSlug = home?.gamer_tag ? gamerTagToSlug(home.gamer_tag) : gamerTagToSlug(homeName);
    const awaySlug = away?.gamer_tag ? gamerTagToSlug(away.gamer_tag) : gamerTagToSlug(awayName);

    payload = {
      matchId: pick.id,
      status: pick.status,
      players: [
        { displayName: homeName, slug: homeSlug, photoUrl: home?.photo_url ?? null, score: homeScore },
        { displayName: awayName, slug: awaySlug, photoUrl: away?.photo_url ?? null, score: awayScore },
      ],
    };
  }

  return NextResponse.json(
    {
      payload,
      seasonId: md.season_id,
      channel: REALTIME.standingsChannel(md.season_id),
    },
    {
      headers: {
        "Cache-Control": "s-maxage=15, stale-while-revalidate=60",
      },
    },
  );
}
