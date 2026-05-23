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

  // 2026-05-23 — resilient match-day + season resolution.
  //
  // Original logic 404'd when session.match_day_id pointed to a
  // soft-deleted or missing row, leaving overlays (esp. 22-power-
  // rankings) stuck on static demo data forever. Now we fall back
  // through three layers so live standings ALWAYS load when a season
  // exists:
  //   1. session's bound match_day (preferred — gives true "WEEK N")
  //   2. latest played match_day on the same season (when 1 missing)
  //   3. latest active season (when neither 1 nor 2 resolves)
  let seasonId: string | null = null;
  let matchDayNumber: number | null = null;
  let matchDate: string | null = null;

  if (sess.match_day_id) {
    const { data: mdRaw } = await sb
      .from("match_days")
      .select("id, season_id, match_day_number, played_at")
      .eq("id", sess.match_day_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (mdRaw) {
      const md = mdRaw as {
        id: string;
        season_id: string;
        match_day_number: number | null;
        played_at: string | null;
      };
      seasonId = md.season_id;
      matchDayNumber = md.match_day_number;
      matchDate = md.played_at;
    }
  }

  // Fallback 2 — season resolved but match-day stale: pull latest
  // played match-day on that season so "WEEK N" still surfaces.
  if (seasonId && matchDayNumber == null) {
    const { data: latestMd } = await sb
      .from("match_days")
      .select("match_day_number, played_at")
      .eq("season_id", seasonId)
      .is("deleted_at", null)
      .not("played_at", "is", null)
      .order("match_day_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestMd) {
      const lm = latestMd as {
        match_day_number: number | null;
        played_at: string | null;
      };
      matchDayNumber = lm.match_day_number;
      matchDate = lm.played_at;
    }
  }

  // Fallback 3 — no season resolved from session: use the latest active
  // season globally. Lets a stale / detached session still render the
  // current standings instead of black overlay.
  // seasons table uses start_date (date) — see migration 20260422000001.
  if (!seasonId) {
    const { data: latestSeason } = await sb
      .from("seasons")
      .select("id")
      .is("deleted_at", null)
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    seasonId = (latestSeason as { id: string } | null)?.id ?? null;
    if (seasonId) {
      const { data: latestMd2 } = await sb
        .from("match_days")
        .select("match_day_number, played_at")
        .eq("season_id", seasonId)
        .is("deleted_at", null)
        .not("played_at", "is", null)
        .order("match_day_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestMd2) {
        const lm = latestMd2 as {
          match_day_number: number | null;
          played_at: string | null;
        };
        matchDayNumber = lm.match_day_number;
        matchDate = lm.played_at;
      }
    }
  }

  if (!seasonId) {
    return NextResponse.json({ error: "no active season" }, { status: 404 });
  }

  // Optional `?topN=` override — defaults to 13 (full Elite roster),
  // capped at 13 by reader. Older callers may still pass `topN=10`.
  const topNRaw = req.nextUrl.searchParams.get("topN");
  const topN = topNRaw ? Number(topNRaw) : 13;

  const data = await fetchLeaderboardData(sb, seasonId, topN);
  const payload = toLeaderboardAnimatedPayload(data);

  return NextResponse.json(
    {
      payload,
      seasonId: data.seasonId,
      channel: data.channel,
      // 2026-05-23 — overlay 22-power-rankings reads matchDayNumber +
      // matchDate so its "WEEK N · YYYY-MM-DD" sub-headline reflects
      // the active match-day instead of hard-coded "WEEK 3 · 2026-05-09".
      matchDayNumber,
      matchDate,
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
