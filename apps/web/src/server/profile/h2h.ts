import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Plan 41 §3.2 — Head-to-head grid.
 *
 * For the subject player, aggregate W-D-L + GF-GA against every other
 * player in the season. Both home and away matches count toward the same
 * opponent row. Void matches are excluded per Plan 11. Matches without a
 * confirmed result are excluded (they're not part of the official H2H
 * record yet). The subject player is never included in the output.
 */

export type H2HRow = {
  opponentId: string;
  opponentDisplayName: string;
  mp: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
};

type OppSide = {
  id: string;
  gamer_tag: string | null;
  users:
    | { display_name: string | null }
    | Array<{ display_name: string | null }>
    | null;
};

type MatchRow = {
  id: string;
  home_player_id: string;
  away_player_id: string;
  match_results:
    | Array<{
        home_score: number;
        away_score: number;
        result_type: "normal" | "forfeit" | "void";
        confirmed_at: string | null;
      }>
    | {
        home_score: number;
        away_score: number;
        result_type: "normal" | "forfeit" | "void";
        confirmed_at: string | null;
      }
    | null;
  home: OppSide | null;
  away: OppSide | null;
};

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function displayFor(row: OppSide | null): string {
  if (!row) return "—";
  const user = pickOne(row.users);
  return user?.display_name ?? row.gamer_tag ?? "—";
}

export async function getH2HGrid(
  sb: SupabaseClient,
  playerId: string,
  seasonId: string,
): Promise<H2HRow[]> {
  const { data, error } = await sb
    .from("matches")
    .select(
      `
      id, home_player_id, away_player_id,
      match_results ( home_score, away_score, result_type, confirmed_at ),
      home:home_player_id ( id, gamer_tag, users:users!players_user_id_fkey ( display_name ) ),
      away:away_player_id ( id, gamer_tag, users:users!players_user_id_fkey ( display_name ) )
      `,
    )
    .eq("season_id", seasonId)
    .is("deleted_at", null)
    .or(`home_player_id.eq.${playerId},away_player_id.eq.${playerId}`);
  if (error) throw new Error(`getH2HGrid: ${error.message}`);

  const rows = (data ?? []) as unknown as MatchRow[];

  // Aggregate into an opponentId-keyed map so bidirectional matches collapse
  // onto the same grid row.
  const acc = new Map<
    string,
    { opponentId: string; opponentDisplayName: string; mp: number; w: number; d: number; l: number; gf: number; ga: number }
  >();

  for (const r of rows) {
    const res = pickOne(r.match_results);
    if (!res) continue;
    if (res.confirmed_at == null) continue;
    if (res.result_type === "void") continue;

    const wasHome = r.home_player_id === playerId;
    const opp = wasHome ? r.away : r.home;
    if (!opp) continue;
    // Defensive: skip self. Should never happen given the `home_player_id <> away_player_id` DB constraint.
    if (opp.id === playerId) continue;

    const gf = wasHome ? res.home_score : res.away_score;
    const ga = wasHome ? res.away_score : res.home_score;

    const existing = acc.get(opp.id) ?? {
      opponentId: opp.id,
      opponentDisplayName: displayFor(opp),
      mp: 0,
      w: 0,
      d: 0,
      l: 0,
      gf: 0,
      ga: 0,
    };
    existing.mp += 1;
    existing.gf += gf;
    existing.ga += ga;
    if (gf > ga) existing.w += 1;
    else if (gf < ga) existing.l += 1;
    else existing.d += 1;
    // If we saw the opp-name later (e.g. first match was missing embed),
    // upgrade.
    if (existing.opponentDisplayName === "—") {
      existing.opponentDisplayName = displayFor(opp);
    }
    acc.set(opp.id, existing);
  }

  // Sort: opponents with most matches played first, then by display name.
  return Array.from(acc.values()).sort((a, b) => {
    if (b.mp !== a.mp) return b.mp - a.mp;
    return a.opponentDisplayName.localeCompare(b.opponentDisplayName);
  });
}
