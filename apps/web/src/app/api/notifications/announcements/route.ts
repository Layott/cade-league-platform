import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { listAnnouncementsForUser } from "@/server/announcements";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Plan 40 §3.3 + §5 — GET /api/notifications/announcements
 *
 * Returns { rows: Announcement[] } for the calling user. Each row
 * represents a notification the user has received (audience filter was
 * applied at publish time in `publishNow()`); the body_md is joined
 * inline so the bell modal's detail pane doesn't need a second fetch.
 *
 * 401 for unauthenticated callers. Empty list for authenticated users
 * who haven't been targeted by any announcement yet.
 */
export async function GET() {
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

  const rows = await listAnnouncementsForUser(sb, pub.id);
  return NextResponse.json({ rows });
}
