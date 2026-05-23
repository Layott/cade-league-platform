import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { checkViewToken } from "@/server/broadcast/view_token_gate";
import { enforcePublicRead } from "@/lib/api-rate-limit";
import { fetchCoverUpStats } from "@/server/overlays/cover_up_stats";
import { buildDidYouKnowVariants } from "@/server/overlays/did_you_know_variants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Did-You-Know variants feed for overlay 25-did-you-know.
 *
 * Returns up to 10 distinct stat-driven cards the producer can pick
 * from in the broadcast control panel. Each variant carries a stable
 * `variantId` + the same `{ player, headline, detail, kind }` shape
 * the overlay's `update()` already consumes — so the trigger pipeline
 * is unchanged: control panel posts `{ type:'show', data:{ payload:
 * { didYouKnow: <chosen variant> } } }`, overlay renders it.
 *
 * Auth: view-token gated (matches the leaderboard + cover-up endpoints).
 * Cache: 60s edge cache + Realtime-driven re-fetch on standings change.
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

  // Resolve season via session → match_day.
  const { data: sess } = await sb
    .from("stream_sessions")
    .select("match_day_id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  const sessionRow = sess as { match_day_id: string } | null;

  let seasonId: string | null = null;
  if (sessionRow?.match_day_id) {
    const { data: md } = await sb
      .from("match_days")
      .select("season_id")
      .eq("id", sessionRow.match_day_id)
      .is("deleted_at", null)
      .maybeSingle();
    seasonId = (md as { season_id: string } | null)?.season_id ?? null;
  }

  // Fallback: latest active season.
  if (!seasonId) {
    const { data: latest } = await sb
      .from("seasons")
      .select("id")
      .is("deleted_at", null)
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    seasonId = (latest as { id: string } | null)?.id ?? null;
  }

  if (!seasonId) {
    return NextResponse.json({ error: "no active season" }, { status: 404 });
  }

  const stats = await fetchCoverUpStats(sb, seasonId);
  const variants = buildDidYouKnowVariants(stats.payload);

  return NextResponse.json(
    {
      variants,
      seasonId: stats.seasonId,
      channel: stats.channel,
    },
    {
      headers: {
        "Cache-Control": "s-maxage=60, stale-while-revalidate=300",
      },
    },
  );
}
