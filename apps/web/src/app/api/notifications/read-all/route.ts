import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { markAllRead } from "@/server/announcements";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Plan 40 §5 — POST /api/notifications/read-all
 *
 * Marks every still-unread notification owned by the caller as read.
 * Idempotent: a second call matches zero rows and returns 204 cleanly.
 */
export async function POST() {
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return new NextResponse("Unauthorized", { status: 401 });

  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!pub) return new NextResponse("Unauthorized", { status: 401 });

  await markAllRead(sb, pub.id);
  return new NextResponse(null, { status: 204 });
}
