import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { checkViewToken } from "@/server/broadcast/view_token_gate";
import { enforcePublicRead } from "@/lib/api-rate-limit";
import {
  fetchLeaderboardData,
  toLeaderboardAnimatedPayload,
} from "@/server/overlays/leaderboard_data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Audit Slice 1 — live-data feed for the `/overlay/leaderboard-animated`
 * overlay. Reads the session's match_day → season, then returns the top
 * standings rows pre-shaped as a `LeaderboardAnimatedPayload`.
 *
 * Auth: same `view_token` gate as the other unauthenticated overlay
 * endpoints (shared helper in server/broadcast/view_token_gate.ts).
 *
 * Response shape:
 *   { payload: LeaderboardAnimatedPayload | null, seasonId: string,
 *     channel: string }
 *
 * `payload` is null when the season has no standings rows yet (empty
 * roster / no confirmed matches). The client renders "NO STANDINGS YET"
 * in that case.
 *
 * `Cache-Control: no-store` — browser-source sessions live for hours and
 * we never want a stale leaderboard pinned across a redeploy.
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

  // Resolve the session → match_day → season.
  const { data: sessRaw, error: sessErr } = await sb
    .from("stream_sessions")
    .select("id, match_day_id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (sessErr || !sessRaw) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  const sess = sessRaw as { id: string; match_day_id: string };

  const { data: mdRaw, error: mdErr } = await sb
    .from("match_days")
    .select("id, season_id")
    .eq("id", sess.match_day_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (mdErr || !mdRaw) {
    return NextResponse.json({ error: "match_day not found" }, { status: 404 });
  }
  const md = mdRaw as { id: string; season_id: string };

  // Optional `?topN=` override — defaults to 13 (full Elite roster),
  // capped at 13 by reader. Older callers may still pass `topN=10`.
  const topNRaw = req.nextUrl.searchParams.get("topN");
  const topN = topNRaw ? Number(topNRaw) : 13;

  const data = await fetchLeaderboardData(sb, md.season_id, topN);
  const payload = toLeaderboardAnimatedPayload(data);

  return NextResponse.json(
    {
      payload,
      seasonId: data.seasonId,
      channel: data.channel,
    },
    {
      headers: {
        // 2026-05-11 — CDN-cached to stay under Vercel Hobby compute
        // cap. Realtime `standings.changed` event drives mid-stream
        // re-fetch; the 60s edge cache absorbs the burst of tab opens.
        "Cache-Control": "s-maxage=60, stale-while-revalidate=300",
      },
    },
  );
}
