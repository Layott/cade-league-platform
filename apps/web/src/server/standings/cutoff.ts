import type { SupabaseClient } from "@supabase/supabase-js";
import type { StandingsRow } from "./read";

export type Cutoff =
  | { type: "matchday"; matchDayId: string }
  | { type: "match"; matchId: string };

export type MatchDayInfo = {
  id: string;
  match_date: string;
  match_number: number;
};

export type MatchInOrder = {
  id: string;
  match_day_id: string;
  match_order: number;
  match_date: string;
  home_player_id: string;
  away_player_id: string;
};

function firstOrNull<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export async function listSeasonMatchDays(
  sb: SupabaseClient,
  seasonId: string,
): Promise<MatchDayInfo[]> {
  const { data, error } = await sb
    .from("match_days")
    .select("id, match_date")
    .eq("season_id", seasonId)
    .is("deleted_at", null)
    .order("match_date", { ascending: true });
  if (error) throw new Error(`listSeasonMatchDays failed: ${error.message}`);
  return ((data ?? []) as { id: string; match_date: string }[]).map((row, i) => ({
    id: row.id,
    match_date: row.match_date,
    match_number: i + 1,
  }));
}

export async function listSeasonMatchesOrdered(
  sb: SupabaseClient,
  seasonId: string,
): Promise<MatchInOrder[]> {
  const { data, error } = await sb
    .from("matches")
    .select(
      `
      id, match_day_id, match_order, home_player_id, away_player_id,
      match_day:match_days ( match_date )
      `,
    )
    .eq("season_id", seasonId)
    .is("deleted_at", null);
  if (error) throw new Error(`listSeasonMatchesOrdered failed: ${error.message}`);

  type Row = {
    id: string;
    match_day_id: string;
    match_order: number | null;
    home_player_id: string;
    away_player_id: string;
    match_day: { match_date: string } | { match_date: string }[] | null;
  };
  const rows = ((data ?? []) as unknown as Row[]).map((m) => {
    const md = firstOrNull(m.match_day);
    return {
      id: m.id,
      match_day_id: m.match_day_id,
      match_order: m.match_order ?? 0,
      match_date: md?.match_date ?? "",
      home_player_id: m.home_player_id,
      away_player_id: m.away_player_id,
    };
  });
  rows.sort((a, b) => {
    if (a.match_date !== b.match_date) return a.match_date.localeCompare(b.match_date);
    if (a.match_order !== b.match_order) return a.match_order - b.match_order;
    return a.id.localeCompare(b.id);
  });
  return rows;
}

export function selectMatchesThroughCutoff(
  ordered: MatchInOrder[],
  cutoff: Cutoff,
): MatchInOrder[] {
  if (cutoff.type === "matchday") {
    const target = ordered.find((m) => m.match_day_id === cutoff.matchDayId);
    if (!target) return [];
    return ordered.filter((m) => m.match_date <= target.match_date);
  }
  const idx = ordered.findIndex((m) => m.id === cutoff.matchId);
  if (idx < 0) return [];
  return ordered.slice(0, idx + 1);
}

export async function listStandingsAsOf(
  sb: SupabaseClient,
  seasonId: string,
  cutoff: Cutoff,
): Promise<StandingsRow[]> {
  const ordered = await listSeasonMatchesOrdered(sb, seasonId);
  const included = selectMatchesThroughCutoff(ordered, cutoff);
  const matchById = new Map(included.map((m) => [m.id, m]));

  const { data: participants, error: pErr } = await sb
    .from("season_participants")
    .select(
      `
      player:player_id ( id, gamer_tag, users:users!players_user_id_fkey ( id, display_name ) )
      `,
    )
    .eq("season_id", seasonId)
    .is("deleted_at", null);
  if (pErr) throw new Error(`listStandingsAsOf participants failed: ${pErr.message}`);

  type PlayerJoin = {
    id: string;
    gamer_tag: string;
    users: { id: string; display_name: string | null } | { id: string; display_name: string | null }[] | null;
  };
  type ParticipantRow = { player: PlayerJoin | PlayerJoin[] | null };

  const playerById = new Map<string, { id: string; tag: string; name: string }>();
  for (const row of (participants ?? []) as unknown as ParticipantRow[]) {
    const p = firstOrNull(row.player);
    if (!p) continue;
    const u = firstOrNull(p.users);
    playerById.set(p.id, {
      id: p.id,
      tag: p.gamer_tag,
      name: u?.display_name ?? p.gamer_tag,
    });
  }

  const agg = new Map<
    string,
    { mp: number; w: number; d: number; l: number; gf: number; ga: number }
  >();
  for (const id of playerById.keys()) {
    agg.set(id, { mp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 });
  }

  if (included.length > 0) {
    const ids = included.map((m) => m.id);
    const { data: results, error: rErr } = await sb
      .from("match_results")
      .select("match_id, home_score, away_score, result_type, confirmed_at")
      .in("match_id", ids)
      .is("deleted_at", null)
      .not("confirmed_at", "is", null)
      .in("result_type", ["normal", "forfeit"]);
    if (rErr) throw new Error(`listStandingsAsOf results failed: ${rErr.message}`);

    type MR = {
      match_id: string;
      home_score: number;
      away_score: number;
      result_type: string;
      confirmed_at: string | null;
    };
    for (const r of (results ?? []) as MR[]) {
      const m = matchById.get(r.match_id);
      if (!m) continue;
      const home = agg.get(m.home_player_id);
      const away = agg.get(m.away_player_id);
      if (!home || !away) continue;
      home.mp++;
      away.mp++;
      home.gf += r.home_score;
      home.ga += r.away_score;
      away.gf += r.away_score;
      away.ga += r.home_score;
      if (r.home_score > r.away_score) {
        home.w++;
        away.l++;
      } else if (r.home_score < r.away_score) {
        away.w++;
        home.l++;
      } else {
        home.d++;
        away.d++;
      }
    }
  }

  const rows: StandingsRow[] = [];
  for (const [pid, p] of playerById.entries()) {
    const a = agg.get(pid)!;
    rows.push({
      player_id: pid,
      player_name: p.name,
      gamer_tag: p.tag,
      matches_played: a.mp,
      wins: a.w,
      draws: a.d,
      losses: a.l,
      goals_for: a.gf,
      goals_against: a.ga,
      goal_difference: a.gf - a.ga,
      points: a.w * 3 + a.d,
      punishment_points_deducted: 0,
      punishment_gd_deducted: 0,
    });
  }
  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goal_difference !== a.goal_difference) return b.goal_difference - a.goal_difference;
    return b.goals_for - a.goals_for;
  });
  return rows;
}
