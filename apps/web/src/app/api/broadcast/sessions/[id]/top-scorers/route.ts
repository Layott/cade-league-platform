import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { checkViewToken } from "@/server/broadcast/view_token_gate";
import { enforcePublicRead } from "@/lib/api-rate-limit";
import {
  fetchTopScorersData,
  toTopScorersPayload,
} from "@/server/overlays/top_scorers_data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Audit Slice 1 — live-data feed for the `/overlay/top-scorers` overlay.
 * Resolves session → match_day → season, then aggregates per-player goals
 * via `fetchTopScorersData`.
 *
 * Response: { payload: TopScorersPayload, seasonId, channel }
 * `payload.rows` is empty when no goals scored yet — overlay renders
 * "NO SCORERS YET".
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

  const data = await fetchTopScorersData(sb, md.season_id, 10);
  const payload = toTopScorersPayload(data);

  return NextResponse.json(
    {
      payload,
      seasonId: data.seasonId,
      channel: data.channel,
    },
    {
      headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" },
    },
  );
}
