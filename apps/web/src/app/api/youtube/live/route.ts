import { NextRequest, NextResponse } from "next/server";
import { gateYoutubeRequest } from "../_helpers";
import { resolveChannelId } from "@/server/youtube/channel";
import { listLiveVideos } from "@/server/youtube/live";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/youtube/live?sessionId=...
 *
 * Lists currently-live YouTube videos on the CADE Esports channel. The
 * `sessionId` query param is currently only used for symmetry with the
 * other /api/youtube/* routes — no session state is read.
 *
 * Perm: `broadcast.match_control`.
 *
 * Response:
 *   { videos: Array<{videoId, title, thumbnailUrl, liveChatId, startedAt}> }
 *
 * Errors:
 *   401 — unauth
 *   403 — missing perm
 *   502 — upstream YouTube failure (quota / network). Body: { error }
 */

const CADE_HANDLE = "@CadeEsports";

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
    const channelId = await resolveChannelId(CADE_HANDLE);
    const videos = await listLiveVideos(channelId);
    return NextResponse.json({ videos });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 502 },
    );
  }
}
