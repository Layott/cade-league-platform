import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { listForUser } from "@/server/notifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 2026-04-24 — GET /api/notifications/all
 *
 * Returns the full notification stream (every `type`) for the signed-in
 * user. Powers the bell dropdown + /notifications listing. The older
 * /api/notifications/announcements endpoint keeps an announcement-only
 * contract for the prior modal surface; this endpoint serves the unified
 * bell.
 *
 * Query params:
 *   - unreadOnly=1    → only unread rows
 *   - limit=N         → clamp to N (default 50, cap 200)
 */
export async function GET(req: NextRequest) {
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

  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unreadOnly") === "1";
  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const limit = Math.min(
    Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1),
    200,
  );

  const rows = await listForUser(sb, pub.id, { unreadOnly, limit });
  return NextResponse.json({ rows });
}
