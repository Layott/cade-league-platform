/**
 * Plan 53 — POST /api/broadcast/v2/photos/uploads/url
 *
 * Two-phase upload step 1: returns one signed PUT URL per file under
 * `raw/<playerId>/<uploadId>/<filename>` in the `player-photos` bucket. The
 * browser PUTs each file directly to storage — no server buffering. After all
 * PUTs succeed the client calls `/uploads/[id]/finalize` to flip the row to
 * `status='ready'`.
 *
 * Body: { playerId, mode: "single"|"multi", files: [{filename, bytes}] }
 * Gates on `overlay.design.manage`.
 */
import { NextResponse } from "next/server";
import { requireActor, AuthError } from "@/lib/auth-server";
import {
  requestPlayerPhotoUploadUrls,
  PlayerPhotoUploadError,
} from "@/server/overlays/player-photos/upload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  playerId?: string;
  mode?: "single" | "multi";
  files?: { filename: string; bytes: number }[];
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

  const body = (await req.json().catch(() => null)) as Body | null;
  if (
    !body ||
    !body.playerId ||
    !body.mode ||
    !Array.isArray(body.files) ||
    body.files.length === 0
  ) {
    return NextResponse.json(
      { error: "playerId, mode, files[] required" },
      { status: 400 },
    );
  }

  try {
    const result = await requestPlayerPhotoUploadUrls({
      sb,
      actor,
      playerId: body.playerId,
      mode: body.mode,
      files: body.files,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof PlayerPhotoUploadError) {
      return NextResponse.json(
        { error: e.code, message: e.message },
        { status: 400 },
      );
    }
    throw e;
  }
}
