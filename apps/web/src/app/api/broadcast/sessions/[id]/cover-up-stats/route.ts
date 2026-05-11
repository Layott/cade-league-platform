import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { checkViewToken } from "@/server/broadcast/view_token_gate";
import { enforcePublicRead } from "@/lib/api-rate-limit";
import { fetchCoverUpStats } from "@/server/overlays/cover_up_stats";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Combined data feed for cover-up overlays 21 / 23 / 24 / 25 / 29.
 * Each overlay's HTML `update()` reads its slice from the shared payload
 * shape. View-token gated like the other per-session overlay endpoints.
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
  if (!sessRaw) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  const sess = sessRaw as { id: string; match_day_id: string };

  const { data: mdRaw } = await sb
    .from("match_days")
    .select("id, season_id")
    .eq("id", sess.match_day_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!mdRaw) {
    return NextResponse.json({ error: "match_day not found" }, { status: 404 });
  }
  const md = mdRaw as { id: string; season_id: string };

  const result = await fetchCoverUpStats(sb, md.season_id);

  return NextResponse.json(result, {
    headers: {
      // 2026-05-11 — switched from no-store to CDN-cached + SWR so
      // repeated tab opens / dashboard mounts hit the Vercel edge cache
      // instead of cold-starting a function each time. 60s freshness is
      // well below the realtime channel's update cadence; SWR keeps
      // stale data on the wire while the next regen fires in the
      // background. Major Hobby-compute saver.
      "Cache-Control": "s-maxage=60, stale-while-revalidate=300",
    },
  });
}
