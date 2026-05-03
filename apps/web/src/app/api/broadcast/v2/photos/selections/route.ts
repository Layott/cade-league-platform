/**
 * Plan 53 — POST/DELETE /api/broadcast/v2/photos/selections
 *
 * POST   — set a player's pose for either a specific overlay (overlayKey set)
 *          or the global default (overlayKey null). Body:
 *            { playerId, overlayKey?, poseIndex, source }
 * DELETE — soft-clear an existing selection. Body: { playerId, overlayKey? }.
 *
 * Both gate on `overlay.design.manage` via `requireActor`. Mutation runs
 * through the service-role client so the audit trigger sees the actor on
 * `app.current_user_id` without RLS interfering.
 */
import { NextResponse } from "next/server";
import { requireActor, AuthError } from "@/lib/auth-server";
import {
  setPlayerPose,
  clearPlayerPose,
} from "@/server/overlays/player-photos/mutations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PostBody = {
  playerId?: string;
  overlayKey?: string | null;
  poseIndex?: number;
  source?: "manifest" | "upload";
};

type DeleteBody = {
  playerId?: string;
  overlayKey?: string | null;
};

function authErrorResponse(err: AuthError): NextResponse {
  if (err.code === "rate_limited" && err.rateLimitResponse) {
    return err.rateLimitResponse;
  }
  return NextResponse.json(
    { error: err.code },
    { status: err.code === "unauthorized" ? 401 : 403 },
  );
}

export async function POST(req: Request) {
  let actorBundle;
  try {
    actorBundle = await requireActor("overlay.design.manage");
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e);
    throw e;
  }
  const { sb, actor } = actorBundle;

  const body = (await req.json().catch(() => null)) as PostBody | null;
  if (
    !body ||
    !body.playerId ||
    typeof body.poseIndex !== "number" ||
    !body.source
  ) {
    return NextResponse.json(
      { error: "playerId, poseIndex, source required" },
      { status: 400 },
    );
  }
  if (body.source !== "manifest" && body.source !== "upload") {
    return NextResponse.json(
      { error: "source must be 'manifest' or 'upload'" },
      { status: 400 },
    );
  }

  try {
    await setPlayerPose({
      sb,
      actor,
      playerId: body.playerId,
      overlayKey: body.overlayKey ?? null,
      poseIndex: body.poseIndex,
      source: body.source,
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  let actorBundle;
  try {
    actorBundle = await requireActor("overlay.design.manage");
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e);
    throw e;
  }
  const { sb, actor } = actorBundle;

  const body = (await req.json().catch(() => null)) as DeleteBody | null;
  if (!body || !body.playerId) {
    return NextResponse.json(
      { error: "playerId required" },
      { status: 400 },
    );
  }

  try {
    await clearPlayerPose({
      sb,
      actor,
      playerId: body.playerId,
      overlayKey: body.overlayKey ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
