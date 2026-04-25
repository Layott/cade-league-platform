import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { hasPermAsync } from "@/lib/perms-db";
import { getActiveSeason } from "@/server/seasons";
import { loadLeaderboard } from "@/server/standings/leaderboard_view";

/**
 * Plan 51 — GET /api/tournament/leaderboard
 *
 * Returns the tiebreaker-sorted standings with form column for the supplied
 * `seasonId` (or the active season when omitted). Used by `LiveLeaderboard`
 * to refresh after `standings.changed` Realtime events.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  const svc = getServiceRoleSupabase();
  const ok = await hasPermAsync(svc, { userId: pub.id, roles }, "tournament.read");
  if (!ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  let seasonId = sp.get("seasonId");
  if (!seasonId) {
    const season = await getActiveSeason(svc);
    if (!season) {
      return NextResponse.json({ rows: [], seasonId: null });
    }
    seasonId = season.id;
  }

  try {
    const rows = await loadLeaderboard(svc, seasonId);
    return NextResponse.json(
      { rows, seasonId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "leaderboard read failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
