import { NextRequest, NextResponse } from "next/server";
import { gateYoutubeRequest } from "../_helpers";
import { resolveChannelId } from "@/server/youtube/channel";
import { listLiveVideos } from "@/server/youtube/live";
import { listChannels } from "@/server/youtube/channels";
import { getServiceRoleSupabase } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/youtube/live?sessionId=...
 *
 * Lists currently-live YouTube videos on every channel in
 * `public.youtube_channels` (Plan 47 — replaces Plan 44 hard-coded
 * `@CadeEsports`). The `sessionId` query param is currently only used
 * for symmetry with the other /api/youtube/* routes — no session
 * state is read.
 *
 * Perm: `broadcast.match_control`.
 *
 * Response:
 *   { videos: Array<{videoId, title, thumbnailUrl, liveChatId, startedAt, channelHandle}> }
 *
 * Errors:
 *   401 — unauth
 *   403 — missing perm
 *   502 — upstream YouTube failure (quota / network). Body: { error }
 */

// Fallback when the DB registry is empty (fresh deploy before
// migration 20260511000200 is applied).
const FALLBACK_HANDLE = "@CadeEsports";

export async function GET(req: NextRequest) {
  const gate = await gateYoutubeRequest();
  if (!gate.ok) return gate.res;

  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId required" },
      { status: 400 },
    );
  }

  try {
    const svc = getServiceRoleSupabase();
    const channels = await listChannels(svc).catch(() => []);
    const handles =
      channels.length > 0
        ? channels.map((c) => c.handle)
        : [FALLBACK_HANDLE];

    const all: Array<Record<string, unknown>> = [];
    for (const handle of handles) {
      try {
        const channelId = await resolveChannelId(handle);
        const videos = await listLiveVideos(channelId);
        for (const v of videos) {
          all.push({ ...v, channelHandle: handle });
        }
      } catch {
        // Skip a channel that fails individually — other channels
        // might still have live streams worth listing.
        continue;
      }
    }
    return NextResponse.json({ videos: all });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 502 },
    );
  }
}
