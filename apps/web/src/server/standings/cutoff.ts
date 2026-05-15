import type { SupabaseClient } from "@supabase/supabase-js";
import type { StandingsRow } from "./read";

export type Cutoff =
  | { type: "matchday"; matchDayId: string }
  | { type: "matchday-only"; matchDayId: string }
  | { type: "week-only"; matchDayId: string }
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
  /**
   * Earliest confirmed_at across non-deleted, non-void match_results
   * for this match. Null when no confirmed result exists yet (unplayed
   * or pending). Used to sort matches in "result-entry order" so
   * /standings/matchday/[n]/match/[matchId] cutoff reflects the order
   * in which results were entered.
   */
  result_confirmed_at: string | null;
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
      match_day:match_days ( match_date ),
      results:match_results ( confirmed_at, result_type, deleted_at )
      `,
    )
    .eq("season_id", seasonId)
    .is("deleted_at", null);
  if (error) throw new Error(`listSeasonMatchesOrdered failed: ${error.message}`);

  type ResultRow = {
    confirmed_at: string | null;
    result_type: string;
    deleted_at: string | null;
  };
  type Row = {
    id: string;
    match_day_id: string;
    match_order: number | null;
    home_player_id: string;
    away_player_id: string;
    match_day: { match_date: string } | { match_date: string }[] | null;
    results: ResultRow[] | ResultRow | null;
  };
  const rows = ((data ?? []) as unknown as Row[]).map((m) => {
    const md = firstOrNull(m.match_day);
    const allResults: ResultRow[] = Array.isArray(m.results)
      ? m.results
      : m.results
        ? [m.results]
        : [];
    const eligible = allResults.filter(
      (r) =>
        !r.deleted_at &&
        !!r.confirmed_at &&
        (r.result_type === "normal" || r.result_type === "forfeit"),
    );
    const earliestConfirmed =
      eligible.length === 0
        ? null
        : eligible.reduce<string | null>((acc, r) => {
            if (!r.confirmed_at) return acc;
            if (!acc) return r.confirmed_at;
            return r.confirmed_at < acc ? r.confirmed_at : acc;
          }, null);
    return {
      id: m.id,
      match_day_id: m.match_day_id,
      match_order: m.match_order ?? 0,
      match_date: md?.match_date ?? "",
      home_player_id: m.home_player_id,
      away_player_id: m.away_player_id,
      result_confirmed_at: earliestConfirmed,
    };
  });
  rows.sort((a, b) => {
    // Confirmed matches first (in chronological result-entry order).
    // Unplayed matches (null confirmed_at) sort after, by canonical
    // schedule order (date, then announced match_order).
    const aHas = a.result_confirmed_at != null;
    const bHas = b.result_confirmed_at != null;
    if (aHas && bHas) {
      if (a.result_confirmed_at! !== b.result_confirmed_at!) {
        return a.result_confirmed_at! < b.result_confirmed_at! ? -1 : 1;
      }
    } else if (aHas !== bHas) {
      return aHas ? -1 : 1;
    }
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
  if (cutoff.type === "matchday-only") {
    return ordered.filter((m) => m.match_day_id === cutoff.matchDayId);
  }
  if (cutoff.type === "week-only") {
    const target = ordered.find((m) => m.match_day_id === cutoff.matchDayId);
    if (!target) return [];
    const includedMdIds = new Set<string>([cutoff.matchDayId]);
    const targetTs = Date.parse(target.match_date);
    for (const m of ordered) {
      if (m.match_day_id === cutoff.matchDayId) continue;
      const diff = Math.abs(Date.parse(m.match_date) - targetTs) / 86_400_000;
      if (diff === 1) includedMdIds.add(m.match_day_id);
    }
    return ordered.filter((m) => includedMdIds.has(m.match_day_id));
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

  // 2026-05-15 — apply disciplinary deductions whose `effective_from` is
  // on-or-before the cutoff date so per-match-day standings reflect the
  // running impact from the date the sanction landed onward. Only applied
  // to cumulative ("matchday" / "match") cutoffs — the matchday-only and
  // week-only views show points SCORED in the period, not net standings,
  // and would double-count the deduction if a player carried a sanction
  // INTO that window from a prior match day.
  const punishmentByPlayer = await aggregatePunishmentsAsOf(
    sb,
    seasonId,
    playerById,
    cutoff,
    included,
    ordered,
  );

  const rows: StandingsRow[] = [];
  for (const [pid, p] of playerById.entries()) {
    const a = agg.get(pid)!;
    const ded = punishmentByPlayer.get(pid) ?? { pts: 0, gd: 0 };
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
      goal_difference: a.gf - a.ga - ded.gd,
      points: a.w * 3 + a.d - ded.pts,
      punishment_points_deducted: ded.pts,
      punishment_gd_deducted: ded.gd,
    });
  }
  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goal_difference !== a.goal_difference) return b.goal_difference - a.goal_difference;
    return b.goals_for - a.goals_for;
  });
  return rows;
}

/**
 * Aggregate live disciplinary deductions per player whose `effective_from`
 * date is on-or-before the cutoff's reference date.
 *
 * Reference date by cutoff kind:
 *   - "matchday" → the target match day's `match_date`. Deductions
 *     effective on this date count (matches the user's "on May 10 + after"
 *     mental model).
 *   - "match"    → same as above; the target match's date.
 *   - "matchday-only" / "week-only" → returns empty. These views are
 *     intra-period scoring tables, not net cumulative standings.
 *
 * Returns Map<player_id, {pts, gd}> with zero defaults filled by the
 * caller.
 */
async function aggregatePunishmentsAsOf(
  sb: SupabaseClient,
  seasonId: string,
  playerById: Map<string, { id: string; tag: string; name: string }>,
  cutoff: Cutoff,
  included: MatchInOrder[],
  ordered: MatchInOrder[],
): Promise<Map<string, { pts: number; gd: number }>> {
  const out = new Map<string, { pts: number; gd: number }>();
  if (cutoff.type !== "matchday" && cutoff.type !== "match") return out;

  // Resolve the cutoff calendar date — the deduction's `effective_from`
  // must be <= this date for the deduction to count.
  let cutoffDate: string | null = null;
  if (cutoff.type === "matchday") {
    const md = await sb
      .from("match_days")
      .select("match_date")
      .eq("id", cutoff.matchDayId)
      .is("deleted_at", null)
      .maybeSingle();
    cutoffDate =
      (md.data as { match_date: string } | null)?.match_date ?? null;
  } else {
    // "match" cutoff: derive from the included list (last included match's
    // match_date). `included` is already pruned to <= cutoff match; fall
    // back to scanning `ordered` if the target match isn't yet played.
    const last = included[included.length - 1];
    if (last?.match_date) cutoffDate = last.match_date;
    else {
      const found = ordered.find((m) => m.id === cutoff.matchId);
      cutoffDate = found?.match_date ?? null;
    }
  }
  if (!cutoffDate) return out;

  // Pull every live sanction in the season + filter by date. Cross-table
  // join through `disciplinary_cases` to surface the affected player.
  const { data, error } = await sb
    .from("disciplinary_actions")
    .select(
      `
      magnitude, sanction_type, effective_from,
      case:disciplinary_cases ( player_id, deleted_at )
      `,
    )
    .in("sanction_type", ["point_deduction", "gd_deduction"])
    .is("deleted_at", null)
    .is("revoked_at", null)
    .lte("effective_from", cutoffDate);
  if (error) {
    throw new Error(`aggregatePunishmentsAsOf failed: ${error.message}`);
  }

  type CaseRef = { player_id: string; deleted_at: string | null };
  type ActionRow = {
    magnitude: number;
    sanction_type: "point_deduction" | "gd_deduction";
    effective_from: string;
    case: CaseRef | CaseRef[] | null;
  };

  for (const a of (data ?? []) as ActionRow[]) {
    const c = firstOrNull(a.case);
    if (!c || c.deleted_at) continue;
    if (!playerById.has(c.player_id)) continue; // ignore players outside this season
    const slot = out.get(c.player_id) ?? { pts: 0, gd: 0 };
    if (a.sanction_type === "point_deduction") slot.pts += a.magnitude;
    if (a.sanction_type === "gd_deduction") slot.gd += a.magnitude;
    out.set(c.player_id, slot);
  }
  return out;
}
