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
  scheduled_time: string | null;
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

function firstOf<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

/**
 * Up-next feed for 10-up-next-bug overlay. Returns the next scheduled
 * (not in-progress, not completed) match on the session's match-day,
 * ordered by scheduled_time ASC.
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

  const { data: matchesRaw } = await sb
    .from("matches")
    .select(
      `
      id, status, scheduled_time,
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
    .eq("status", "scheduled")
    .is("deleted_at", null)
    .order("scheduled_time", { ascending: true })
    .limit(1);

  const rows = (matchesRaw ?? []) as unknown as MatchRow[];
  const next = rows[0] ?? null;

  let payload: unknown = null;
  if (next) {
    const home = next.home_player;
    const away = next.away_player;
    const homeUser = firstOf(home?.users ?? null);
    const awayUser = firstOf(away?.users ?? null);
    const homeName = homeUser?.display_name || home?.gamer_tag || "";
    const awayName = awayUser?.display_name || away?.gamer_tag || "";
    payload = {
      matchId: next.id,
      kickoffAt: next.scheduled_time ?? new Date().toISOString(),
      home: {
        displayName: homeName,
        gamerTag: home?.gamer_tag ?? undefined,
        slug: home?.gamer_tag ? gamerTagToSlug(home.gamer_tag) : gamerTagToSlug(homeName),
        photoUrl: home?.photo_url ?? null,
      },
      away: {
        displayName: awayName,
        gamerTag: away?.gamer_tag ?? undefined,
        slug: away?.gamer_tag ? gamerTagToSlug(away.gamer_tag) : gamerTagToSlug(awayName),
        photoUrl: away?.photo_url ?? null,
      },
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
        "Cache-Control": "s-maxage=30, stale-while-revalidate=120",
      },
    },
  );
}
