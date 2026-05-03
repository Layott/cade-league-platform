import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { checkViewToken } from "@/server/broadcast/view_token_gate";
import { enforcePublicRead } from "@/lib/api-rate-limit";
import { gamerTagToSlug } from "@/lib/player-photos";
import { resolvePlayerPose } from "@/server/overlays/player-photos/resolver";
import {
  buildPhotoUrl,
  getVariantKindForOverlay,
} from "@/server/overlays/player-photos/variant-map";

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
  //
  // Plan 53 (2026-05-04) — `display_name` and `avatar_url` are NOT
  // columns on `public.players`; `display_name` lives on the joined
  // `users` row, and `avatar_url` was always null on this table (the
  // resolver replaces that field). Read `gamer_tag` + the embedded
  // user display name, then derive avatarUrl through `resolvePlayerPose`
  // + `buildPhotoUrl` for the overlay key '17-penalties'.
  const playerIds = Array.from(new Set(actions.map((a) => a.player_id)));
  type PlayerMeta = {
    name: string;
    gamerTag: string | null;
  };
  let metaById = new Map<string, PlayerMeta>();
  if (playerIds.length > 0) {
    try {
      const { data } = await sb
        .from("players")
        .select(
          `
          id,
          gamer_tag,
          users:users!players_user_id_fkey ( display_name )
          `,
        )
        .in("id", playerIds)
        .is("deleted_at", null);
      type PlayerJoinRow = {
        id: string;
        gamer_tag: string | null;
        users:
          | { display_name: string | null }
          | { display_name: string | null }[]
          | null;
      };
      for (const p of (data ?? []) as unknown as PlayerJoinRow[]) {
        const userRow = Array.isArray(p.users) ? p.users[0] ?? null : p.users;
        metaById.set(p.id, {
          name: userRow?.display_name ?? p.gamer_tag ?? "Player",
          gamerTag: p.gamer_tag,
        });
      }
    } catch {
      metaById = new Map();
    }
  }

  const overlayKey = "17-penalties";
  const variantKind = getVariantKindForOverlay(overlayKey);
  const rows = await Promise.all(
    actions.map(async (a) => {
      const meta = metaById.get(a.player_id);
      const slug = meta?.gamerTag ? gamerTagToSlug(meta.gamerTag) : "";
      let avatarUrl: string | null = null;
      if (slug) {
        const resolved = await resolvePlayerPose(sb, a.player_id, overlayKey, {
          slug,
        });
        avatarUrl = buildPhotoUrl({
          slug,
          playerId: a.player_id,
          poseIndex: resolved.poseIndex,
          variantKind,
          source: resolved.source,
        });
      }
      return {
        actionId: a.id,
        playerId: a.player_id,
        playerName: meta?.name ?? "Player",
        avatarUrl,
        pointsAdj: a.points_adj ?? 0,
        gdAdj: a.gd_adj ?? 0,
        severity: a.severity ?? null,
        incidentType: a.incident_type ?? null,
        summary: a.summary ?? null,
        decidedAt: a.decided_at ?? null,
        expiresAt: a.expires_at ?? null,
      };
    }),
  );

  return NextResponse.json(
    { payload: { rows }, seasonId: md.season_id },
    { headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } },
  );
}
