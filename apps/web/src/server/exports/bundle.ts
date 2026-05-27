import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { buildFormMap } from "./leaderboard_xlsx";

/**
 * Full tournament bundle export — single download containing tournament
 * metadata + organizer, sponsors/partners, match days, matchups + results,
 * leaderboard, walkovers + disciplinary actions.
 *
 * Two output formats:
 *   - JSON: nested object (one file).
 *   - XLSX: multi-sheet workbook with one tab per section.
 *
 * All readers are best-effort — a single section failing returns empty
 * instead of killing the whole bundle. Section errors land in
 * `_meta.warnings` so callers can surface partial-bundle state.
 */

const ORGANIZER_NAME = "CADE Esports";
const LEAGUE_NAME = "CADE National eSoccer Pro League";
const LEAGUE_PRODUCT = "GameEvo Pro League";

type SeasonRow = {
  id: string;
  year_range: string;
  division_name: string;
  start_date: string;
  end_date: string;
  status: string;
};

type PartnerRow = {
  partner_key: string;
  label: string;
  display_label: string | null;
  alt: string;
  file_url: string;
  sort_order: number;
};

type MatchDayRow = {
  id: string;
  match_date: string;
  arrival_cutoff_time: string;
  match_start_time: string;
  venue_name: string;
  status: string;
  notes: string | null;
};

type PlayerRow = {
  id: string;
  gamer_tag: string | null;
  users: { display_name: string | null } | null;
};

type MatchRow = {
  id: string;
  match_day_id: string;
  scheduled_time: string | null;
  status: string;
  match_slot: number | null;
  match_lane: number | null;
  home_player_id: string;
  away_player_id: string;
};

type MatchResultRow = {
  match_id: string;
  home_score: number;
  away_score: number;
  result_type: string;
  is_walkover: boolean | null;
  walkover_initiated_by: string | null;
  confirmed_at: string | null;
  created_at: string | null;
  match: {
    home_player_id: string;
    away_player_id: string;
    season_id: string;
    match_day_id: string | null;
  } | null;
};

type StandingsRow = {
  player_id: string;
  matches_played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
  player: {
    gamer_tag: string | null;
    users: { display_name: string | null } | null;
  } | null;
};

type DisciplinaryRow = {
  id: string;
  sanction_type: string;
  magnitude: number;
  effective_from: string | null;
  effective_until: string | null;
  imposed_at: string | null;
  notes: string | null;
  case:
    | { player_id: string; season_id: string | null }
    | { player_id: string; season_id: string | null }[]
    | null;
};

export type BundleData = {
  meta: {
    organizer: string;
    league: string;
    product: string;
    generatedAt: string;
    seasonId: string;
    warnings: string[];
  };
  tournament: {
    seasonId: string;
    yearRange: string;
    divisionName: string;
    startDate: string;
    endDate: string;
    status: string;
  };
  sponsors: Array<{
    partnerKey: string;
    label: string;
    displayLabel: string;
    alt: string;
    fileUrl: string;
    sortOrder: number;
  }>;
  matchDays: Array<{
    id: string;
    matchDate: string;
    arrivalCutoffTime: string;
    matchStartTime: string;
    venueName: string;
    status: string;
    notes: string | null;
  }>;
  players: Array<{ id: string; name: string }>;
  matchups: Array<{
    matchId: string;
    matchDayId: string;
    matchDate: string;
    scheduledTime: string | null;
    matchSlot: number | null;
    matchLane: number | null;
    homePlayer: string;
    awayPlayer: string;
    status: string;
    homeScore: number | null;
    awayScore: number | null;
    resultType: string | null;
    isWalkover: boolean;
    confirmedAt: string | null;
  }>;
  leaderboard: Array<{
    pos: number;
    playerId: string;
    player: string;
    p: number;
    w: number;
    d: number;
    l: number;
    gf: number;
    ga: number;
    gd: number;
    pts: number;
    form: string;
  }>;
  walkovers: Array<{
    matchDate: string;
    homePlayer: string;
    awayPlayer: string;
    homeScore: number;
    awayScore: number;
    initiatedBy: string | null;
  }>;
  disciplinary: Array<{
    player: string;
    sanctionType: string;
    magnitude: number;
    effectiveFrom: string | null;
    effectiveUntil: string | null;
    imposedAt: string | null;
    notes: string | null;
  }>;
};

async function readSeason(
  sb: SupabaseClient,
  seasonId: string,
): Promise<SeasonRow | null> {
  const { data, error } = await sb
    .from("seasons")
    .select("id, year_range, division_name, start_date, end_date, status")
    .eq("id", seasonId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`bundle season read: ${error.message}`);
  return (data as SeasonRow | null) ?? null;
}

async function readPartners(sb: SupabaseClient): Promise<PartnerRow[]> {
  const { data, error } = await sb
    .from("overlay_partner_logos")
    .select("partner_key, label, display_label, alt, file_url, sort_order")
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });
  if (error) {
    console.warn(`bundle partners read failed: ${error.message}`);
    return [];
  }
  return (data ?? []) as PartnerRow[];
}

async function readMatchDays(
  sb: SupabaseClient,
  seasonId: string,
): Promise<MatchDayRow[]> {
  const { data, error } = await sb
    .from("match_days")
    .select(
      "id, match_date, arrival_cutoff_time, match_start_time, venue_name, status, notes",
    )
    .eq("season_id", seasonId)
    .is("deleted_at", null)
    .order("match_date", { ascending: true });
  if (error) throw new Error(`bundle match days read: ${error.message}`);
  return (data ?? []) as MatchDayRow[];
}

async function readPlayers(sb: SupabaseClient): Promise<PlayerRow[]> {
  const { data, error } = await sb
    .from("players")
    .select(
      "id, gamer_tag, users:users!players_user_id_fkey ( display_name )",
    )
    .is("deleted_at", null);
  if (error) throw new Error(`bundle players read: ${error.message}`);
  return (data ?? []) as unknown as PlayerRow[];
}

async function readMatches(
  sb: SupabaseClient,
  seasonId: string,
): Promise<MatchRow[]> {
  const { data, error } = await sb
    .from("matches")
    .select(
      "id, match_day_id, scheduled_time, status, match_slot, match_lane, home_player_id, away_player_id",
    )
    .eq("season_id", seasonId)
    .is("deleted_at", null);
  if (error) throw new Error(`bundle matches read: ${error.message}`);
  return (data ?? []) as MatchRow[];
}

async function readResults(
  sb: SupabaseClient,
  seasonId: string,
): Promise<MatchResultRow[]> {
  const { data, error } = await sb
    .from("match_results")
    .select(
      `match_id, home_score, away_score, result_type,
       is_walkover, walkover_initiated_by, confirmed_at, created_at,
       match:match_id ( home_player_id, away_player_id, season_id, match_day_id )`,
    )
    .is("deleted_at", null);
  if (error) {
    console.warn(`bundle results read failed: ${error.message}`);
    return [];
  }
  return ((data ?? []) as unknown as MatchResultRow[]).filter(
    (r) => r.match?.season_id === seasonId,
  );
}

async function readStandings(
  sb: SupabaseClient,
  seasonId: string,
): Promise<StandingsRow[]> {
  const { data, error } = await sb
    .from("standings")
    .select(
      `player_id, matches_played, wins, draws, losses,
       goals_for, goals_against, goal_difference, points,
       player:player_id ( gamer_tag, users:users!players_user_id_fkey ( display_name ) )`,
    )
    .eq("season_id", seasonId)
    .is("deleted_at", null)
    .order("points", { ascending: false })
    .order("goal_difference", { ascending: false })
    .order("goals_for", { ascending: false });
  if (error) throw new Error(`bundle standings read: ${error.message}`);
  return (data ?? []) as unknown as StandingsRow[];
}

async function readDisciplinary(
  sb: SupabaseClient,
  seasonId: string,
): Promise<DisciplinaryRow[]> {
  const { data, error } = await sb
    .from("disciplinary_actions")
    .select(
      `id, sanction_type, magnitude, effective_from, effective_until,
       imposed_at, notes, case:case_id ( player_id, season_id )`,
    )
    .is("deleted_at", null);
  if (error) {
    console.warn(`bundle disciplinary read failed: ${error.message}`);
    return [];
  }
  const rows = (data ?? []) as unknown as DisciplinaryRow[];
  return rows.filter((r) => {
    const c = Array.isArray(r.case) ? r.case[0] : r.case;
    return c?.season_id === seasonId;
  });
}

function playerNameOf(p: PlayerRow): string {
  return p.users?.display_name ?? p.gamer_tag ?? "(unknown)";
}

function standingsName(s: StandingsRow): string {
  return s.player?.users?.display_name ?? s.player?.gamer_tag ?? "(unknown)";
}

export async function collectBundleData(
  seasonId: string,
  sb: SupabaseClient,
): Promise<BundleData> {
  const warnings: string[] = [];
  const season = await readSeason(sb, seasonId);
  if (!season) throw new Error(`bundle: season ${seasonId} not found`);

  const [partners, matchDays, players, matches, results, standings, discipline] =
    await Promise.all([
      readPartners(sb).catch((e: Error) => {
        warnings.push(`partners: ${e.message}`);
        return [] as PartnerRow[];
      }),
      readMatchDays(sb, seasonId).catch((e: Error) => {
        warnings.push(`match_days: ${e.message}`);
        return [] as MatchDayRow[];
      }),
      readPlayers(sb).catch((e: Error) => {
        warnings.push(`players: ${e.message}`);
        return [] as PlayerRow[];
      }),
      readMatches(sb, seasonId).catch((e: Error) => {
        warnings.push(`matches: ${e.message}`);
        return [] as MatchRow[];
      }),
      readResults(sb, seasonId).catch((e: Error) => {
        warnings.push(`results: ${e.message}`);
        return [] as MatchResultRow[];
      }),
      readStandings(sb, seasonId).catch((e: Error) => {
        warnings.push(`standings: ${e.message}`);
        return [] as StandingsRow[];
      }),
      readDisciplinary(sb, seasonId).catch((e: Error) => {
        warnings.push(`disciplinary: ${e.message}`);
        return [] as DisciplinaryRow[];
      }),
    ]);

  const nameById = new Map<string, string>();
  for (const p of players) nameById.set(p.id, playerNameOf(p));

  const matchDayById = new Map<string, MatchDayRow>();
  for (const md of matchDays) matchDayById.set(md.id, md);

  const resultByMatchId = new Map<string, MatchResultRow>();
  for (const r of results) resultByMatchId.set(r.match_id, r);

  const matchups: BundleData["matchups"] = matches
    .map((m) => {
      const r = resultByMatchId.get(m.id) ?? null;
      const md = matchDayById.get(m.match_day_id);
      return {
        matchId: m.id,
        matchDayId: m.match_day_id,
        matchDate: md?.match_date ?? "",
        scheduledTime: m.scheduled_time,
        matchSlot: m.match_slot,
        matchLane: m.match_lane,
        homePlayer: nameById.get(m.home_player_id) ?? "(unknown)",
        awayPlayer: nameById.get(m.away_player_id) ?? "(unknown)",
        status: m.status,
        homeScore: r?.home_score ?? null,
        awayScore: r?.away_score ?? null,
        resultType: r?.result_type ?? null,
        isWalkover: r?.is_walkover === true,
        confirmedAt: r?.confirmed_at ?? null,
      };
    })
    .sort((a, b) => {
      if (a.matchDate !== b.matchDate) {
        return a.matchDate < b.matchDate ? -1 : 1;
      }
      const sa = a.matchSlot ?? 9999;
      const sb_ = b.matchSlot ?? 9999;
      if (sa !== sb_) return sa - sb_;
      return (a.matchLane ?? 9999) - (b.matchLane ?? 9999);
    });

  const formMap = buildFormMap(
    results.map((r) => ({
      match_id: r.match_id,
      home_score: r.home_score,
      away_score: r.away_score,
      created_at: r.created_at,
      match: r.match
        ? {
            home_player_id: r.match.home_player_id,
            away_player_id: r.match.away_player_id,
            season_id: r.match.season_id,
          }
        : null,
    })),
  );

  const leaderboard: BundleData["leaderboard"] = standings.map((s, idx) => ({
    pos: idx + 1,
    playerId: s.player_id,
    player: standingsName(s),
    p: s.matches_played,
    w: s.wins,
    d: s.draws,
    l: s.losses,
    gf: s.goals_for,
    ga: s.goals_against,
    gd: s.goal_difference,
    pts: s.points,
    form: formMap.get(s.player_id) ?? "",
  }));

  const walkovers: BundleData["walkovers"] = results
    .filter((r) => r.is_walkover === true)
    .map((r) => {
      const md = r.match?.match_day_id
        ? matchDayById.get(r.match.match_day_id)
        : null;
      return {
        matchDate: md?.match_date ?? "",
        homePlayer:
          nameById.get(r.match?.home_player_id ?? "") ?? "(unknown)",
        awayPlayer:
          nameById.get(r.match?.away_player_id ?? "") ?? "(unknown)",
        homeScore: r.home_score,
        awayScore: r.away_score,
        initiatedBy: r.walkover_initiated_by,
      };
    });

  const disciplinary: BundleData["disciplinary"] = discipline.map((r) => {
    const c = Array.isArray(r.case) ? r.case[0] : r.case;
    return {
      player: nameById.get(c?.player_id ?? "") ?? c?.player_id ?? "",
      sanctionType: r.sanction_type,
      magnitude: r.magnitude,
      effectiveFrom: r.effective_from,
      effectiveUntil: r.effective_until,
      imposedAt: r.imposed_at,
      notes: r.notes,
    };
  });

  return {
    meta: {
      organizer: ORGANIZER_NAME,
      league: LEAGUE_NAME,
      product: LEAGUE_PRODUCT,
      generatedAt: new Date().toISOString(),
      seasonId,
      warnings,
    },
    tournament: {
      seasonId: season.id,
      yearRange: season.year_range,
      divisionName: season.division_name,
      startDate: season.start_date,
      endDate: season.end_date,
      status: season.status,
    },
    sponsors: partners.map((p) => ({
      partnerKey: p.partner_key,
      label: p.label,
      displayLabel: p.display_label ?? p.label,
      alt: p.alt,
      fileUrl: p.file_url,
      sortOrder: p.sort_order,
    })),
    matchDays: matchDays.map((md) => ({
      id: md.id,
      matchDate: md.match_date,
      arrivalCutoffTime: md.arrival_cutoff_time,
      matchStartTime: md.match_start_time,
      venueName: md.venue_name,
      status: md.status,
      notes: md.notes,
    })),
    players: players
      .map((p) => ({ id: p.id, name: playerNameOf(p) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    matchups,
    leaderboard,
    walkovers,
    disciplinary,
  };
}

export function buildBundleWorkbook(data: BundleData): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const meta: Array<Array<string | number>> = [
    ["Field", "Value"],
    ["Organizer", data.meta.organizer],
    ["League", data.meta.league],
    ["Product", data.meta.product],
    ["Generated At", data.meta.generatedAt],
    ["Season Year", data.tournament.yearRange],
    ["Division", data.tournament.divisionName],
    ["Start Date", data.tournament.startDate],
    ["End Date", data.tournament.endDate],
    ["Status", data.tournament.status],
  ];
  if (data.meta.warnings.length > 0) {
    meta.push(["Warnings", data.meta.warnings.join("; ")]);
  }
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(meta),
    "Tournament",
  );

  const sponsors: Array<Array<string | number>> = [
    ["Sort Order", "Label", "Display Label", "Alt Text", "Partner Key", "File URL"],
  ];
  for (const s of data.sponsors) {
    sponsors.push([
      s.sortOrder,
      s.label,
      s.displayLabel,
      s.alt,
      s.partnerKey,
      s.fileUrl,
    ]);
  }
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(sponsors),
    "Sponsors",
  );

  const matchDays: Array<Array<string | number>> = [
    [
      "Match Date",
      "Venue",
      "Arrival Cutoff",
      "Match Start",
      "Status",
      "Notes",
    ],
  ];
  for (const md of data.matchDays) {
    matchDays.push([
      md.matchDate,
      md.venueName,
      md.arrivalCutoffTime,
      md.matchStartTime,
      md.status,
      md.notes ?? "",
    ]);
  }
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(matchDays),
    "Match Days",
  );

  const players: Array<Array<string | number>> = [["Name", "Player ID"]];
  for (const p of data.players) players.push([p.name, p.id]);
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(players),
    "Players",
  );

  const matchups: Array<Array<string | number>> = [
    [
      "Match Date",
      "Slot",
      "Lane",
      "Scheduled Time",
      "Home Player",
      "Away Player",
      "Status",
      "Home Score",
      "Away Score",
      "Result Type",
      "Walkover",
      "Confirmed At",
    ],
  ];
  for (const m of data.matchups) {
    matchups.push([
      m.matchDate,
      m.matchSlot ?? "",
      m.matchLane ?? "",
      m.scheduledTime ?? "",
      m.homePlayer,
      m.awayPlayer,
      m.status,
      m.homeScore ?? "",
      m.awayScore ?? "",
      m.resultType ?? "",
      m.isWalkover ? "yes" : "no",
      m.confirmedAt ?? "",
    ]);
  }
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(matchups),
    "Matchups",
  );

  const lb: Array<Array<string | number>> = [
    ["Pos", "Player", "P", "W", "D", "L", "GF", "GA", "GD", "Pts", "Form"],
  ];
  for (const r of data.leaderboard) {
    lb.push([
      r.pos,
      r.player,
      r.p,
      r.w,
      r.d,
      r.l,
      r.gf,
      r.ga,
      r.gd,
      r.pts,
      r.form,
    ]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(lb), "Leaderboard");

  const wo: Array<Array<string | number>> = [
    [
      "Match Date",
      "Home Player",
      "Away Player",
      "Home Score",
      "Away Score",
      "Initiated By",
    ],
  ];
  for (const r of data.walkovers) {
    wo.push([
      r.matchDate,
      r.homePlayer,
      r.awayPlayer,
      r.homeScore,
      r.awayScore,
      r.initiatedBy ?? "",
    ]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wo), "Walkovers");

  const disc: Array<Array<string | number>> = [
    [
      "Player",
      "Sanction Type",
      "Magnitude",
      "Effective From",
      "Effective Until",
      "Imposed At",
      "Notes",
    ],
  ];
  for (const r of data.disciplinary) {
    disc.push([
      r.player,
      r.sanctionType,
      r.magnitude,
      r.effectiveFrom ?? "",
      r.effectiveUntil ?? "",
      r.imposedAt ?? "",
      r.notes ?? "",
    ]);
  }
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(disc),
    "Disciplinary",
  );

  return wb;
}

export async function generateBundleJSON(
  seasonId: string,
  sb: SupabaseClient,
): Promise<Buffer> {
  const data = await collectBundleData(seasonId, sb);
  return Buffer.from(JSON.stringify(data, null, 2), "utf-8");
}

export async function generateBundleXLSX(
  seasonId: string,
  sb: SupabaseClient,
): Promise<Buffer> {
  const data = await collectBundleData(seasonId, sb);
  const wb = buildBundleWorkbook(data);
  const out = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  return out as Buffer;
}
