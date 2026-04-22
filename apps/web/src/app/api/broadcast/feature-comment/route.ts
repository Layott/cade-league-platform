import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import {
  requirePermAsync,
  PermissionError,
} from "@/lib/perms-db";
import { triggerOverlay } from "@/server/broadcast/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/broadcast/feature-comment
 * Body:
 *   {
 *     sessionId: string;
 *     messageId: string;
 *     authorName: string;
 *     authorPhotoUrl?: string;
 *     message: string;
 *     postedAt: string;          // ISO
 *     displaySeconds?: number;   // default 10
 *     slot?: "primary" | "secondary"; // default "primary"
 *   }
 *
 * Fires an `overlay_events` row with `template_key='featured_comment'`
 * carrying the viewer's comment. The overlay page subscribes via Plan
 * 37 realtime and pops the card for `displaySeconds`, then auto-clears.
 *
 * Perm: broadcast.match_control.
 */
export async function POST(req: NextRequest) {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) return new NextResponse("Unauthorized", { status: 401 });

  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) return new NextResponse("Unauthorized", { status: 401 });

  const { data: rolesRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (rolesRows ?? []).map((r: { role: string }) => r.role);

  const sb = getServiceRoleSupabase();
  try {
    await requirePermAsync(
      sb,
      { userId: pub.id, roles },
      "broadcast.match_control",
    );
  } catch (err) {
    if (err instanceof PermissionError) {
      return new NextResponse("Forbidden", { status: 403 });
    }
    throw err;
  }

  const body = (await req.json().catch(() => null)) as {
    sessionId?: string;
    messageId?: string;
    authorName?: string;
    authorPhotoUrl?: string | null;
    message?: string;
    postedAt?: string;
    displaySeconds?: number;
    slot?: "primary" | "secondary";
  } | null;
  if (
    !body ||
    !body.sessionId ||
    !body.authorName ||
    !body.message ||
    !body.postedAt
  ) {
    return NextResponse.json(
      { error: "sessionId, authorName, message, postedAt required" },
      { status: 400 },
    );
  }

  const payload: Record<string, unknown> = {
    authorName: body.authorName,
    message: body.message,
    postedAt: body.postedAt,
    displaySeconds: body.displaySeconds ?? 10,
    slot: body.slot === "secondary" ? "secondary" : "primary",
  };
  if (body.authorPhotoUrl) payload.authorPhotoUrl = body.authorPhotoUrl;

  try {
    const out = await triggerOverlay(sb, {
      sessionId: body.sessionId,
      templateKey: "featured_comment",
      payload,
      userId: pub.id,
    });
    return NextResponse.json(
      { id: out.id, messageId: body.messageId ?? null },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
