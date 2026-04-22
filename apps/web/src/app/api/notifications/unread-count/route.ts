import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getUnreadCountForAuthUser } from "@/lib/notifications/unreadCount";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Plan 40 §3.3 + §5 — GET /api/notifications/unread-count
 *
 * Returns { count: number } — the size of the caller's still-unread
 * notification queue. Polled by `<AnnouncementBell />` every 60 s so the
 * red dot reflects fresh publishes without a page refresh.
 *
 * Unauthenticated callers get 401; the bell is only mounted for
 * authenticated sessions so this path is never hit from a signed-out
 * context in the happy path. Returning a zero-count in that case would
 * mask misuse elsewhere.
 */
export async function GET() {
  const sb = await getServerSupabase();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return new NextResponse("Unauthorized", { status: 401 });

  const count = await getUnreadCountForAuthUser(sb);
  return NextResponse.json({ count });
}
