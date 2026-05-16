import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { checkViewToken } from "@/server/broadcast/view_token_gate";
import { enforcePublicRead } from "@/lib/api-rate-limit";
import { REALTIME } from "@/server/overlays/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Live score-bug feed for 09-secondary-score-bug overlay.
 *
 * 2026-05-16 rewrite — now OPERATOR-AUTHORITATIVE. Reads the latest
 * un-cleared overlay_events row keyed to `score_bug` and returns its
 * payload verbatim. Returns `{payload: null}` when nothing is pinned so
 * polling OBS browser sources hide the bug instead of revealing an
 * auto-picked matches-table row the operator never selected.
 *
 * Previous matches-table auto-pick caused a live regression: operator
 * triggered Guru vs Dadaboi but the endpoint returned Faruk vs
 * Wolevation (the session's first in_progress match) and the overlay
 * flipped on stream.
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

  // OPERATOR-AUTHORITATIVE PATH (2026-05-16 fix).
  //
  // Realtime broadcast on the overlay route is currently broken on prod
  // — the OverlayDataInjector iframe sits inside an unresolved Suspense
  // boundary so its useEffect never runs, no Realtime channel subscribes,
  // and trigger postMessages never reach the static HTML. Live OBS
  // browser sources therefore only ever see what THIS endpoint returns
  // on poll / initial fetch.
  //
  // Before this fix the endpoint always read from the matches table —
  // so operator triggers from the broadcast control panel (Guru vs
  // Dadaboi with custom scores) were invisible on the stream, which
  // kept defaulting to whatever the first in_progress match happened to
  // be (Faruk vs Wolevation in the live incident).
  //
  // Fix: when the session has an ACTIVE score_bug overlay_events row
  // (most recent, not cleared) prefer ITS payload over the auto-picked
  // matches row. Falls through to the matches-table pick when nothing
  // is pinned so OBS sources still get a meaningful first frame.
  const { data: pinnedRaw } = await sb
    .from("overlay_events")
    .select(
      "payload, triggered_at, overlay_templates:template_id ( template_key )",
    )
    .eq("stream_session_id", id)
    .is("cleared_at", null)
    .is("deleted_at", null)
    .order("triggered_at", { ascending: false })
    .limit(10);
  type PinnedRow = {
    payload: Record<string, unknown> | null;
    triggered_at: string;
    overlay_templates:
      | { template_key: string }
      | { template_key: string }[]
      | null;
  };
  const pinnedRows = (pinnedRaw ?? []) as unknown as PinnedRow[];
  const pinned = pinnedRows.find((r) => {
    const tpl = r.overlay_templates;
    const flat = Array.isArray(tpl) ? tpl[0] : tpl;
    return flat?.template_key === "score_bug";
  });
  if (pinned?.payload && typeof pinned.payload === "object") {
    return NextResponse.json(
      {
        payload: pinned.payload,
        seasonId: md.season_id,
        channel: REALTIME.standingsChannel(md.season_id),
      },
      {
        headers: {
          // Short cache so the operator's next Trigger is picked up
          // within ~5s by polling OBS sources.
          "Cache-Control": "s-maxage=5, stale-while-revalidate=15",
        },
      },
    );
  }

  // No active score_bug pinned by the operator — return null payload
  // so polling OBS sources HIDE the bug instead of revealing an
  // auto-picked matches-table row the operator never selected (Bug
  // 2026-05-16: overlay flipped to Faruk vs Wolevation when the
  // operator had never triggered them).
  return NextResponse.json(
    {
      payload: null,
      seasonId: md.season_id,
      channel: REALTIME.standingsChannel(md.season_id),
    },
    {
      headers: {
        "Cache-Control": "s-maxage=5, stale-while-revalidate=15",
      },
    },
  );
}
