import { NextRequest, NextResponse } from "next/server";
import { gateYoutubeRequest } from "../_helpers";
import { bindLiveStream } from "@/server/youtube/bind";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/youtube/bind
 * Body: { sessionId: string; videoId: string; liveChatId: string }
 * Perm: broadcast.match_control.
 *
 * Writes the three youtube_* columns on stream_sessions. Audit via trigger.
 */
export async function POST(req: NextRequest) {
  const gate = await gateYoutubeRequest();
  if (!gate.ok) return gate.res;

  const body = (await req.json().catch(() => null)) as {
    sessionId?: string;
    videoId?: string;
    liveChatId?: string;
  } | null;
  if (!body || !body.sessionId || !body.videoId || !body.liveChatId) {
    return NextResponse.json(
      { error: "sessionId, videoId, liveChatId required" },
      { status: 400 },
    );
  }

  try {
    const out = await bindLiveStream(
      gate.ctx.sb,
      body.sessionId,
      body.videoId,
      body.liveChatId,
      { userId: gate.ctx.publicUserId, roles: gate.ctx.roles },
    );
    return NextResponse.json(out, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
