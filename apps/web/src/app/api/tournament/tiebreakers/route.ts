import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { hasPermAsync } from "@/lib/perms-db";
import { getActiveSeason } from "@/server/seasons";
import { publishStandingsChanged } from "@/server/standings/realtime";

/**
 * Plan 51 — POST /api/tournament/tiebreakers
 *
 * Body: `{ order: string[] }`. Persists to the active season's
 * `tiebreaker_order` JSONB and broadcasts `standings.changed` so any
 * subscribed client (LiveLeaderboard, leaderboard overlay) re-sorts.
 *
 * Allowed keys: totalPts, gd, gf, wins, losses, played, name. Anything
 * else 400. Empty array is rejected — DB has a non-null default that we
 * intentionally don't replace with `[]` (would brick the `applyTiebreakers`
 * default-fallback behavior across server boots).
 */

export const dynamic = "force-dynamic";

// Bugfix 2026-04-26: drop `name` from configurable keys; add `ga`
// (Goals Against, lower-better). Engine still anchors with `name` as
// final fallback so equal rows sort deterministically.
const ALLOWED = [
  "totalPts",
  "gd",
  "gf",
  "ga",
  "wins",
  "losses",
  "played",
] as const;

const bodySchema = z.object({
  order: z
    .array(z.enum(ALLOWED))
    .min(1, "order must contain at least one key")
    .max(10, "order must have at most 10 keys"),
});

export async function POST(req: NextRequest) {
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
  const ok = await hasPermAsync(
    svc,
    { userId: pub.id, roles },
    "tournament.tiebreaker_config",
  );
  if (!ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    const body = await req.json();
    parsed = bodySchema.parse(body);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid body";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Dedupe while preserving order (last wins) — JSONB ladder shouldn't
  // contain duplicates.
  const seen = new Set<string>();
  const order: string[] = [];
  for (const k of parsed.order) {
    if (seen.has(k)) continue;
    seen.add(k);
    order.push(k);
  }

  const season = await getActiveSeason(svc);
  if (!season) {
    return NextResponse.json({ error: "No active season" }, { status: 404 });
  }

  const { error } = await svc
    .from("seasons")
    .update({ tiebreaker_order: order })
    .eq("id", season.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Best-effort broadcast — clients re-sort their leaderboard view.
  try {
    await publishStandingsChanged(svc, season.id);
  } catch {
    /* fire-and-forget */
  }

  return NextResponse.json(
    { ok: true, seasonId: season.id, order },
    { headers: { "Cache-Control": "no-store" } },
  );
}
