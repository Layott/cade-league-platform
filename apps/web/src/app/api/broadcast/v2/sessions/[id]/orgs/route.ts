import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { checkViewToken } from "@/server/broadcast/view_token_gate";
import { enforcePublicRead } from "@/lib/api-rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Plan 51 §6 — initial-state feed for `/overlay/v2/15-orgs`.
 *
 * Returns: { payload: { orgs: Array<{ id, name, logoUrl, players: Array<{
 *   playerId, displayName, gamerTag, avatarUrl }>}> } }
 *
 * Reads orgs that have at least one active contract for the live season +
 * groups players by `players.org_id` for the resolved roster.
 *
 * Auth: same view_token gate as the legacy overlay endpoints. When the
 * orgs table is empty (placeholder Mr Oga only), `orgs: []` is returned —
 * the static HTML renders its own "no orgs yet" copy.
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

  // Resolve session → match_day → season for scoping the org+player query.
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

  // Best-effort orgs read — table may not exist yet in dormant deploys.
  let orgs: Array<{
    id: string;
    name: string;
    logoUrl: string | null;
    players: Array<{
      playerId: string;
      displayName: string;
      gamerTag: string | null;
      avatarUrl: string | null;
    }>;
  }> = [];
  try {
    const { data: orgRows } = await sb
      .from("organizations")
      .select("id, name, logo_url")
      .is("deleted_at", null);
    if (orgRows && Array.isArray(orgRows) && orgRows.length > 0) {
      const orgIds = (orgRows as { id: string }[]).map((o) => o.id);
      const { data: playerRows } = await sb
        .from("players")
        .select("id, user_id, display_name, gamer_tag, avatar_url, org_id")
        .in("org_id", orgIds)
        .is("deleted_at", null);
      const byOrg = new Map<
        string,
        Array<{
          playerId: string;
          displayName: string;
          gamerTag: string | null;
          avatarUrl: string | null;
        }>
      >();
      for (const p of (playerRows ?? []) as Array<{
        id: string;
        display_name?: string | null;
        gamer_tag?: string | null;
        avatar_url?: string | null;
        org_id: string;
      }>) {
        const list = byOrg.get(p.org_id) ?? [];
        list.push({
          playerId: p.id,
          displayName: p.display_name ?? p.gamer_tag ?? "Player",
          gamerTag: p.gamer_tag ?? null,
          avatarUrl: p.avatar_url ?? null,
        });
        byOrg.set(p.org_id, list);
      }
      orgs = (orgRows as Array<{ id: string; name: string; logo_url: string | null }>).map(
        (o) => ({
          id: o.id,
          name: o.name,
          logoUrl: o.logo_url,
          players: byOrg.get(o.id) ?? [],
        }),
      );
    }
  } catch {
    // schema gone or missing — fall through with empty array
  }

  return NextResponse.json(
    { payload: { orgs }, seasonId: md.season_id },
    { headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } },
  );
}
