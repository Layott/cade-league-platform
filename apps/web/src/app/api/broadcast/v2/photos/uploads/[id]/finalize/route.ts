/**
 * Plan 53 — POST /api/broadcast/v2/photos/uploads/[id]/finalize
 *
 * Two-phase upload step 2: after the browser has PUT every file to the signed
 * URLs returned by `/uploads/url`, this route flips the `player_photo_uploads`
 * row to `status='ready'`, assigns the next available `pose_index` (>=100 to
 * stay above the 6 manifest poses), and persists the variants_json mapping.
 *
 * Body: { variants?: Record<string, string> }
 * Gates on `overlay.design.manage`.
 */
import { NextResponse } from "next/server";
import { requireActor, AuthError } from "@/lib/auth-server";
import {
  finalizePlayerPhotoUpload,
  PlayerPhotoUploadError,
} from "@/server/overlays/player-photos/upload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  variants?: Record<string, string>;
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

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let actorBundle;
  try {
    actorBundle = await requireActor("overlay.design.manage");
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e);
    throw e;
  }
  const { sb, actor } = actorBundle;

  const body = (await req.json().catch(() => null)) as Body | null;

  try {
    const result = await finalizePlayerPhotoUpload({
      sb,
      actor,
      uploadId: id,
      variants: body?.variants ?? {},
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
