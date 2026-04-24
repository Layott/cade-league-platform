import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { checkViewToken } from "@/server/broadcast/view_token_gate";
import {
  fetchMatchScoresDayDataBySession,
  toMatchScoresDayPayload,
} from "@/server/overlays/match_scores_day_data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Audit Slice 1 — live-data feed for `/overlay/match-scores-day`.
 * Resolves the session → match_day and returns the full day's match
 * list pre-shaped as `MatchScoresDayPayload`, plus the two Realtime
 * channel names the overlay subscribes to (standings + session).
 *
 * Response: { payload, seasonId, channels: { standings, session } }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sb = getServiceRoleSupabase();

  const gate = await checkViewToken(sb, req, id);
  if (!gate.ok) return gate.response;

  const data = await fetchMatchScoresDayDataBySession(sb, id);
  if (!data) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  const payload = toMatchScoresDayPayload(data);

  return NextResponse.json(
    {
      payload,
      seasonId: data.seasonId,
      channels: data.channels,
    },
    {
      headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" },
    },
  );
}
