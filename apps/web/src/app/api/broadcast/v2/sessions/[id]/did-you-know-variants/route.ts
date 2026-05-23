import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { checkViewToken } from "@/server/broadcast/view_token_gate";
import { enforcePublicRead } from "@/lib/api-rate-limit";
import { fetchCoverUpStats } from "@/server/overlays/cover_up_stats";
import {
  buildDidYouKnowVariants,
  type CurrentPlayerStat,
} from "@/server/overlays/did_you_know_variants";
import { gamerTagToSlug } from "@/lib/player-photos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Did-You-Know variants feed for overlay 25-did-you-know.
 *
 * Returns up to 10 distinct stat-driven cards the producer can pick
 * from in the broadcast control panel. Each variant carries a stable
 * `variantId` + the same `{ player, headline, detail, kind }` shape
 * the overlay's `update()` already consumes — so the trigger pipeline
 * is unchanged: control panel posts `{ type:'show', data:{ payload:
 * { didYouKnow: <chosen variant> } } }`, overlay renders it.
 *
 * Auth: view-token gated (matches the leaderboard + cover-up endpoints).
 * Cache: 60s edge cache + Realtime-driven re-fetch on standings change.
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

  // Resolve season via session → match_day.
  const { data: sess } = await sb
    .from("stream_sessions")
    .select("match_day_id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  const sessionRow = sess as { match_day_id: string } | null;

  let seasonId: string | null = null;
  if (sessionRow?.match_day_id) {
    const { data: md } = await sb
      .from("match_days")
      .select("season_id")
      .eq("id", sessionRow.match_day_id)
      .is("deleted_at", null)
      .maybeSingle();
    seasonId = (md as { season_id: string } | null)?.season_id ?? null;
  }

  // Fallback: latest active season.
  if (!seasonId) {
    const { data: latest } = await sb
      .from("seasons")
      .select("id")
      .is("deleted_at", null)
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    seasonId = (latest as { id: string } | null)?.id ?? null;
  }

  if (!seasonId) {
    return NextResponse.json({ error: "no active season" }, { status: 404 });
  }

  const stats = await fetchCoverUpStats(sb, seasonId);

  // 2026-05-23 — pull current-season standings rows so cross-season
  // comparison variants can pair last-season figures with this-season's
  // live numbers. Returners-only — new players have no last-season row.
  const RETURNER_SLUGS = [
    "faruk",
    "killer_freak",
    "baji_jnr",
    "adefola",
    "mitch",
    "mr_oga",
    "anife",
  ];
  const currentBySlug = new Map<string, CurrentPlayerStat>();
  try {
    const { data: standingsRows } = await sb
      .from("standings")
      .select(
        `
        matches_played, wins, draws, losses, goals_for, goals_against,
        goal_difference, points,
        player:player_id ( gamer_tag )
        `,
      )
      .eq("season_id", seasonId)
      .is("deleted_at", null);
    type Row = {
      matches_played: number;
      wins: number;
      draws: number;
      losses: number;
      goals_for: number;
      goals_against: number;
      goal_difference: number;
      points: number;
      player: { gamer_tag: string | null } | { gamer_tag: string | null }[] | null;
    };
    const rows = (standingsRows ?? []) as unknown as Row[];
    for (const r of rows) {
      const playerObj = Array.isArray(r.player) ? r.player[0] : r.player;
      const tag = playerObj?.gamer_tag;
      if (!tag) continue;
      const slug = gamerTagToSlug(tag);
      if (!RETURNER_SLUGS.includes(slug)) continue;
      currentBySlug.set(slug, {
        slug,
        wins: r.wins ?? 0,
        draws: r.draws ?? 0,
        losses: r.losses ?? 0,
        goalsFor: r.goals_for ?? 0,
        goalsAgainst: r.goals_against ?? 0,
        goalDiff: r.goal_difference ?? 0,
        points: r.points ?? 0,
        played: r.matches_played ?? 0,
      });
    }
  } catch {
    // Best-effort — variants short-circuit per-player when current
    // row is missing; cross-season cards just drop out gracefully.
  }

  const variants = buildDidYouKnowVariants(stats.payload, currentBySlug);

  return NextResponse.json(
    {
      variants,
      seasonId: stats.seasonId,
      channel: stats.channel,
    },
    {
      headers: {
        "Cache-Control": "s-maxage=60, stale-while-revalidate=300",
      },
    },
  );
}
