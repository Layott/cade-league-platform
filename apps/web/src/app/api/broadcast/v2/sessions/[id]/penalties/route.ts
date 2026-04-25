import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { checkViewToken } from "@/server/broadcast/view_token_gate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Plan 51 §6 — initial-state feed for `/overlay/v2/17-penalties`.
 *
 * Returns active disciplinary actions (the rows that currently affect
 * standings) — joined to player display info so the overlay can render
 * "FARUK · -3pts · 14 days".
 *
 * Q37 lock: ONLY rows with active penalty effects (points_adj != 0 OR
 * gd_adj != 0 OR is_active flag still true). Closed/expired actions are
 * excluded from the overlay even if they had penalties historically.
 *
 * Auth: view_token gate (same as orgs/coaches/leaderboard endpoints).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  type ActionRow = {
    id: string;
    player_id: string;
    points_adj: number | null;
    gd_adj: number | null;
    severity?: string | null;
    incident_type?: string | null;
    summary?: string | null;
    decided_at?: string | null;
    expires_at?: string | null;
  };

  let actions: ActionRow[] = [];
  try {
    const { data } = await sb
      .from("disciplinary_actions")
      .select(
        "id, player_id, points_adj, gd_adj, severity, incident_type, summary, decided_at, expires_at",
      )
      .is("deleted_at", null)
      .or("points_adj.neq.0,gd_adj.neq.0")
      .order("decided_at", { ascending: false });
    actions = (data ?? []) as ActionRow[];
  } catch {
    actions = [];
  }

  // Hydrate player names.
  const playerIds = Array.from(new Set(actions.map((a) => a.player_id)));
  let nameById = new Map<string, { name: string; avatarUrl: string | null }>();
  if (playerIds.length > 0) {
    try {
      const { data } = await sb
        .from("players")
        .select("id, display_name, gamer_tag, avatar_url")
        .in("id", playerIds);
      for (const p of (data ?? []) as Array<{
        id: string;
        display_name: string | null;
        gamer_tag: string | null;
        avatar_url: string | null;
      }>) {
        nameById.set(p.id, {
          name: p.display_name ?? p.gamer_tag ?? "Player",
          avatarUrl: p.avatar_url,
        });
      }
    } catch {
      nameById = new Map();
    }
  }

  const rows = actions.map((a) => {
    const meta = nameById.get(a.player_id);
    return {
      actionId: a.id,
      playerId: a.player_id,
      playerName: meta?.name ?? "Player",
      avatarUrl: meta?.avatarUrl ?? null,
      pointsAdj: a.points_adj ?? 0,
      gdAdj: a.gd_adj ?? 0,
      severity: a.severity ?? null,
      incidentType: a.incident_type ?? null,
      summary: a.summary ?? null,
      decidedAt: a.decided_at ?? null,
      expiresAt: a.expires_at ?? null,
    };
  });

  return NextResponse.json(
    { payload: { rows }, seasonId: md.season_id },
    { headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } },
  );
}
