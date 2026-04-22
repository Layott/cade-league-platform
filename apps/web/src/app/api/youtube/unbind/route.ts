import { NextRequest, NextResponse } from "next/server";
import { gateYoutubeRequest } from "../_helpers";
import { unbindLiveStream } from "@/server/youtube/bind";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/youtube/unbind
 * Body: { sessionId: string }
 * Perm: broadcast.match_control.
 *
 * Clears youtube_* columns on the session. Chat polling UI stops.
 */
export async function POST(req: NextRequest) {
  const gate = await gateYoutubeRequest();
  if (!gate.ok) return gate.res;

  const body = (await req.json().catch(() => null)) as {
    sessionId?: string;
  } | null;
  if (!body || !body.sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  try {
    const out = await unbindLiveStream(gate.ctx.sb, body.sessionId, {
      userId: gate.ctx.publicUserId,
      roles: gate.ctx.roles,
    });
    return NextResponse.json(out, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
