/**
 * Plan 53 — GET /api/broadcast/v2/photos/[playerId]/gallery
 *
 * Returns the four feeds the admin player-photos gallery page renders:
 *   manifestPoses, uploadedPoses, effectiveGlobalPose, perOverlayOverrides.
 *
 * Read-only — uses the user-scoped supabase client so the request still passes
 * through the authenticated session. No perm gate at the route layer (the
 * page that calls this is itself permission-gated); RLS on the underlying
 * tables is the ultimate guard. Cache-Control: no-store keeps the gallery
 * fresh after uploads + selection writes.
 */
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { listPlayerGallery } from "@/server/overlays/player-photos/gallery";
import { gamerTagToSlug } from "@/lib/player-photos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ playerId: string }> },
) {
  const { playerId } = await ctx.params;
  const sb = await getServerSupabase();
  const { data: player, error } = await sb
    .from("players")
    .select("id, gamer_tag")
    .eq("id", playerId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !player) {
    return NextResponse.json({ error: "player not found" }, { status: 404 });
  }
  const playerRow = player as { id: string; gamer_tag: string | null };
  const slug = gamerTagToSlug(playerRow.gamer_tag ?? "");
  const result = await listPlayerGallery(sb, playerId, { slug });
  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" },
  });
}
