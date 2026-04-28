import { NextRequest, NextResponse } from "next/server";
import { gateYoutubeRequest } from "../_helpers";
import { getSessionBinding } from "@/server/youtube/bind";
import { fetchChatMessages } from "@/server/youtube/chat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/youtube/chat?sessionId=...&pageToken=...
 *
 * Reads the liveChatId from the session row + forwards to the YouTube
 * liveChatMessages.list endpoint. Honors `pollingIntervalMillis` that
 * the admin panel then uses for its next poll.
 *
 * Perm: broadcast.match_control.
 *
 * Errors:
 *   400 — sessionId missing
 *   404 — session has no bound liveChatId
 *   502 — upstream YouTube failure
 */
export async function GET(req: NextRequest) {
  // chat is the only read path on this gate — opt out of the write
  // budget so the 5–10s poll doesn't burn through it.
  const gate = await gateYoutubeRequest("broadcast.match_control", {
    rateLimit: false,
  });
  if (!gate.ok) return gate.res;

  const sessionId = req.nextUrl.searchParams.get("sessionId");
  const pageToken = req.nextUrl.searchParams.get("pageToken");
  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId required" },
      { status: 400 },
    );
  }

  const binding = await getSessionBinding(gate.ctx.sb, sessionId);
  if (!binding) {
    return NextResponse.json(
      { error: "session is not bound to a YouTube stream" },
      { status: 404 },
    );
  }

  try {
    const res = await fetchChatMessages(
      binding.liveChatId,
      pageToken ?? undefined,
    );
    return NextResponse.json({
      videoId: binding.videoId,
      ...res,
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 502 },
    );
  }
}
