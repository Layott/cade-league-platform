import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { hasPermAsync } from "@/lib/perms-db";
import { getActiveSeason } from "@/server/seasons";
import { buildH2HCards } from "@/server/standings/h2h_view";

/**
 * Plan 51 — GET /api/tournament/h2h?ids=playerA,playerB,...
 *
 * Returns one H2HCard per supplied player id (comma-separated, 2-5 ids).
 * Win probability for each card is the average pA against every other
 * selected player, computed via `computeWinProbability`.
 */

export const dynamic = "force-dynamic";

const idsSchema = z
  .string()
  .min(36)
  .max(500)
  .regex(/^[a-fA-F0-9-]+(?:,[a-fA-F0-9-]+){0,4}$/, "expected 1-5 comma-separated UUIDs");

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

  const idsParam = req.nextUrl.searchParams.get("ids") ?? "";
  let ids: string[];
  try {
    idsSchema.parse(idsParam);
    ids = idsParam.split(",").filter((s) => s.length > 0);
  } catch {
    return NextResponse.json({ error: "invalid ids" }, { status: 400 });
  }
  if (ids.length < 1 || ids.length > 5) {
    return NextResponse.json({ error: "ids must be 1-5 long" }, { status: 400 });
  }

  const season = await getActiveSeason(svc);
  if (!season) {
    return NextResponse.json({ cards: [] });
  }

  try {
    const rawCards = await buildH2HCards(svc, season.id, ids);
    // 2026-04-28 fix (Bug #14): unify wire shape with
    // `/api/broadcast/sessions/[id]/h2h` — return `winProbPct` as an
    // integer percent in [0..100]. The admin H2HComparisonCard reads
    // this same payload and is updated to consume integer percent.
    const cards = rawCards.map((c) => ({
      ...c,
      winProbPct: Math.round(c.winProbPct * 100),
    }));
    return NextResponse.json(
      { cards, seasonId: season.id },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "h2h read failed" },
      { status: 500 },
    );
  }
}
