import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { checkViewToken } from "@/server/broadcast/view_token_gate";
import { enforcePublicRead } from "@/lib/api-rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Plan 51 §6 — initial-state feed for `/overlay/v2/16-coaches`.
 *
 * Coaches placeholder: returns an array of `{ playerId, name, avatarUrl,
 * coachId, coachName }`. Per spec §1.2 + §2 Q36, no per-coach stats — just
 * org logo + player face. Until a real coach roster lands, this maps from
 * `players.coach_id` if non-null, otherwise returns the player list with
 * `coachId: null`.
 *
 * Auth: view_token gate (same as orgs/leaderboard endpoints).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = await enforcePublicRead(req);
  if (limited) return limited;

  const { id } = await params;
  const sb = getServiceRoleSupabase();

  const gate = await checkViewToken(sb, req, id);
  if (!gate.ok) return gate.response;

  const { data: sessRaw } = await sb
    .from("stream_sessions")
    .select("id, match_day_id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  const sess = sessRaw as { match_day_id: string } | null;
  if (!sess) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  const { data: mdRaw } = await sb
    .from("match_days")
    .select("season_id")
    .eq("id", sess.match_day_id)
    .maybeSingle();
  const md = mdRaw as { season_id: string } | null;
  if (!md) {
    return NextResponse.json({ error: "match_day not found" }, { status: 404 });
  }

  type PlayerRow = {
    id: string;
    display_name: string | null;
    gamer_tag: string | null;
    avatar_url: string | null;
    coach_id: string | null;
  };

  let players: PlayerRow[] = [];
  try {
    const { data } = await sb
      .from("players")
      .select("id, display_name, gamer_tag, avatar_url, coach_id")
      .is("deleted_at", null)
      .order("display_name", { ascending: true });
    players = (data ?? []) as PlayerRow[];
  } catch {
    players = [];
  }

  // Coach lookup (best-effort — placeholder when coach_id is null).
  const coachIds = Array.from(
    new Set(players.map((p) => p.coach_id).filter((x): x is string => !!x)),
  );
  let coachesById = new Map<string, { id: string; name: string }>();
  if (coachIds.length > 0) {
    try {
      const { data } = await sb
        .from("users")
        .select("id, display_name, full_name, email")
        .in("id", coachIds);
      for (const u of (data ?? []) as Array<{
        id: string;
        display_name?: string | null;
        full_name?: string | null;
        email?: string | null;
      }>) {
        coachesById.set(u.id, {
          id: u.id,
          name: u.display_name ?? u.full_name ?? u.email ?? "Coach",
        });
      }
    } catch {
      coachesById = new Map();
    }
  }

  const rows = players.map((p) => {
    const coach = p.coach_id ? coachesById.get(p.coach_id) ?? null : null;
    return {
      playerId: p.id,
      name: p.display_name ?? p.gamer_tag ?? "Player",
      avatarUrl: p.avatar_url ?? null,
      coachId: coach?.id ?? null,
      coachName: coach?.name ?? null,
    };
  });

  return NextResponse.json(
    { payload: { rows }, seasonId: md.season_id },
    { headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } },
  );
}
