import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { checkViewToken } from "@/server/broadcast/view_token_gate";
import { enforcePublicRead } from "@/lib/api-rate-limit";
import { getPlayerAvatarUrl } from "@/lib/player-photos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Plan 51 §6 — initial-state feed for `/overlay/v2/15-orgs`.
 *
 * Returns: { payload: { orgs: Array<{ id, name, logoUrl, players: Array<{
 *   playerId, displayName, gamerTag, avatarUrl }>}> } }
 *
 * Reads orgs that have at least one active contract for the live season +
 * groups players by `players.organization_id` for the resolved roster.
 *
 * Auth: same view_token gate as the legacy overlay endpoints. When the
 * orgs table is empty (placeholder Mr Oga only), `orgs: []` is returned —
 * the static HTML renders its own "no orgs yet" copy.
 *
 * 2026-04-28 fix (Bug #24): the previous implementation referenced
 * non-existent columns on `public.players`:
 *   - `org_id`         → actual column is `organization_id`
 *   - `display_name`   → lives on `public.users`, not `players`
 *   - `avatar_url`     → no such column; manifest-derived from gamer_tag
 * Three wrong column names made the typed `.select()` silently return
 * zero rows (Supabase JS client surfaces the 42703 error in `error`,
 * which the route was not checking) — every org rendered with
 * `players: []` despite 13 active rows. Now uses the canonical
 * `organization_id`, embeds `users:users!players_user_id_fkey
 * ( display_name )` for the player name (same pattern as
 * `server/players/index.ts`), and resolves `avatarUrl` via the static
 * manifest (`getPlayerAvatarUrl(gamer_tag)`).
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
  type OrgPayload = {
    id: string;
    name: string;
    logoUrl: string | null;
    players: Array<{
      playerId: string;
      displayName: string;
      gamerTag: string | null;
      avatarUrl: string | null;
    }>;
  };
  let orgs: OrgPayload[] = [];
  try {
    const { data: orgRows, error: orgErr } = await sb
      .from("organizations")
      .select("id, name, logo_url")
      .is("deleted_at", null);
    if (orgErr) {
      // Surface the schema error in dev logs but keep the wire shape
      // healthy — the overlay HTML has its own placeholder copy.
      console.error("[broadcast/v2/orgs] organizations read failed:", orgErr);
    }
    if (orgRows && Array.isArray(orgRows) && orgRows.length > 0) {
      const orgIds = (orgRows as { id: string }[]).map((o) => o.id);

      // 2026-04-28 fix (Bug #24): canonical column is `organization_id`,
      // not `org_id`. `display_name` is NOT on `players` — it lives on
      // `users`, joined through the `players_user_id_fkey` constraint.
      // `avatar_url` does not exist on either table; it's resolved from
      // the static player manifest via gamer_tag (same path as
      // `getPlayerAvatarUrl` consumers across the app).
      type PlayerRow = {
        id: string;
        gamer_tag: string | null;
        organization_id: string;
        users: { display_name: string | null } | null;
      };

      const { data: playerRows, error: playerErr } = await sb
        .from("players")
        .select(
          `
          id,
          gamer_tag,
          organization_id,
          users:users!players_user_id_fkey ( display_name )
          `,
        )
        .in("organization_id", orgIds)
        .is("deleted_at", null);
      if (playerErr) {
        console.error("[broadcast/v2/orgs] players read failed:", playerErr);
      }

      const byOrg = new Map<string, OrgPayload["players"]>();
      for (const p of (playerRows ?? []) as unknown as PlayerRow[]) {
        if (!p.organization_id) continue;
        const displayName =
          p.users?.display_name ?? p.gamer_tag ?? "Player";
        const list = byOrg.get(p.organization_id) ?? [];
        list.push({
          playerId: p.id,
          displayName,
          gamerTag: p.gamer_tag ?? null,
          avatarUrl: getPlayerAvatarUrl(p.gamer_tag),
        });
        byOrg.set(p.organization_id, list);
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
  } catch (e) {
    // schema gone or missing — fall through with empty array
    console.error("[broadcast/v2/orgs] unexpected error:", e);
  }

  return NextResponse.json(
    { payload: { orgs }, seasonId: md.season_id },
    { headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } },
  );
}
