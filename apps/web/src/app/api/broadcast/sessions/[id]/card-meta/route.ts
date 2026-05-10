import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { checkViewToken } from "@/server/broadcast/view_token_gate";
import { enforcePublicRead } from "@/lib/api-rate-limit";
import { fetchCardMetaData } from "@/server/overlays/card_meta_data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Data feed for 26-card-meta. Returns most-picked FUT cards across the
 * season's approved squad submissions joined to fc26_players for card
 * art + rating + name. View-token gated; no-store cache.
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

  const result = await fetchCardMetaData(sb, md.season_id, 8);

  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" },
  });
}
