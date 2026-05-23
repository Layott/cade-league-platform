import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { checkViewToken } from "@/server/broadcast/view_token_gate";
import { enforcePublicRead } from "@/lib/api-rate-limit";
import { fetchCoverUpStats } from "@/server/overlays/cover_up_stats";
import { buildPunditryVariants } from "@/server/overlays/punditry_variants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Punditry quote variants feed for overlay 28-punditry. Same pattern
 * as did-you-know-variants — producer picks one of N broadcast lines.
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
  const variants = buildPunditryVariants(stats.payload);

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
