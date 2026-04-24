import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Pickers for the player-side dispute-submit form (Plan 13B rework).
 * Swaps the raw-UUID "Subject ID" input for dropdowns:
 *   - match dispute  → match day → match (only fixtures the raiser played in)
 *   - sanction dispute → sanctions previously issued AGAINST the raiser
 *
 * All readers take `userId` (public.users.id). The matches path walks
 * users → players → matches since matches.home_player_id/away_player_id
 * point at players.id, not users.id.
 */

export type MatchDayOption = {
  id: string;
  matchDate: string; // ISO date
  venueName: string;
};

export type MatchOption = {
  id: string;
  matchDayId: string;
  matchDate: string;
  opponentDisplayName: string;
  scoreText: string | null; // "2-1" when confirmed, otherwise null
  /** Pre-formatted compact label e.g. "Thu 2026-04-16 · vs WOLEVATION · 2-1". */
  label: string;
};

export type SanctionOption = {
  id: string; // disciplinary_actions.id
  caseId: string;
  incidentType: string;
  sanctionType: string;
  magnitude: number;
  effectiveFrom: string;
  notes: string | null;
  label: string;
};

type PlayerRow = { id: string };

type UserSide =
  | { display_name: string | null; email: string }
  | Array<{ display_name: string | null; email: string }>
  | null;

type PlayerSide = {
  id: string;
  gamer_tag: string | null;
  users: UserSide;
} | null;

type MatchJoinRow = {
  id: string;
  match_day_id: string;
  status: string;
  home_player_id: string;
  away_player_id: string;
  home: PlayerSide;
  away: PlayerSide;
  match_days:
    | { id: string; match_date: string; venue_name: string }
    | Array<{ id: string; match_date: string; venue_name: string }>
    | null;
  match_results:
    | Array<{
        home_score: number;
        away_score: number;
        result_type: string;
        confirmed_at: string | null;
      }>
    | {
        home_score: number;
        away_score: number;
        result_type: string;
        confirmed_at: string | null;
      }
    | null;
};

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function displayFor(side: PlayerSide): string {
  if (!side) return "—";
  const user = pickOne(side.users);
  return user?.display_name ?? side.gamer_tag ?? "—";
}

function weekdayShort(iso: string): string {
  // `iso` is a yyyy-mm-dd date string. Build a fixed-noon Date so TZ shift
  // never flips to a neighbouring day; we only want the weekday label.
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

async function resolvePlayerId(
  sb: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from("players")
    .select("id")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`resolvePlayerId: ${error.message}`);
  const row = (data as PlayerRow | null) ?? null;
  return row?.id ?? null;
}

/**
 * Matches the user participated in, most recent first. Limits to 20 to keep
 * the <select> tight — newer seasons first.
 */
export async function listMatchesForUser(
  sb: SupabaseClient,
  userId: string,
  limit = 20,
): Promise<MatchOption[]> {
  const playerId = await resolvePlayerId(sb, userId);
  if (!playerId) return [];

  const { data, error } = await sb
    .from("matches")
    .select(
      `
      id, match_day_id, status, home_player_id, away_player_id,
      match_days:match_day_id ( id, match_date, venue_name ),
      match_results ( home_score, away_score, result_type, confirmed_at ),
      home:home_player_id ( id, gamer_tag, users:users!players_user_id_fkey ( display_name, email ) ),
      away:away_player_id ( id, gamer_tag, users:users!players_user_id_fkey ( display_name, email ) )
      `,
    )
    .or(`home_player_id.eq.${playerId},away_player_id.eq.${playerId}`)
    .is("deleted_at", null)
    .limit(limit * 2); // overfetch; filtered sort happens in-memory.
  if (error) throw new Error(`listMatchesForUser: ${error.message}`);

  const rows = (data ?? []) as unknown as MatchJoinRow[];

  const options: MatchOption[] = rows.map((row) => {
    const md = pickOne(row.match_days);
    const opponent =
      row.home_player_id === playerId ? row.away : row.home;
    const opponentName = displayFor(opponent);
    const result = pickOne(row.match_results);
    let scoreText: string | null = null;
    if (result && result.confirmed_at) {
      const homeFirst = row.home_player_id === playerId;
      const mine = homeFirst ? result.home_score : result.away_score;
      const theirs = homeFirst ? result.away_score : result.home_score;
      scoreText = `${mine}-${theirs}`;
    }
    const date = md?.match_date ?? "";
    const weekday = date ? weekdayShort(date) : "";
    const scoreBit = scoreText ? ` · ${scoreText}` : "";
    const label = `${weekday ? weekday + " " : ""}${date} · vs ${opponentName}${scoreBit}`;
    return {
      id: row.id,
      matchDayId: row.match_day_id,
      matchDate: date,
      opponentDisplayName: opponentName,
      scoreText,
      label,
    };
  });

  options.sort((a, b) => (a.matchDate < b.matchDate ? 1 : -1));
  return options.slice(0, limit);
}

/**
 * Match days on which the user has at least one match. Derived from
 * listMatchesForUser so the picker stays consistent.
 */
export async function listMatchDaysForUser(
  sb: SupabaseClient,
  userId: string,
  limit = 20,
): Promise<MatchDayOption[]> {
  const matches = await listMatchesForUser(sb, userId, limit);
  const seen = new Map<string, MatchDayOption>();
  for (const m of matches) {
    if (!seen.has(m.matchDayId)) {
      seen.set(m.matchDayId, {
        id: m.matchDayId,
        matchDate: m.matchDate,
        venueName: "",
      });
    }
  }
  // Fetch venue names for the match_days we have.
  const ids = Array.from(seen.keys());
  if (ids.length === 0) return [];
  const { data, error } = await sb
    .from("match_days")
    .select("id, venue_name, match_date")
    .in("id", ids)
    .is("deleted_at", null);
  if (error) throw new Error(`listMatchDaysForUser: ${error.message}`);
  for (const md of (data ?? []) as Array<{
    id: string;
    venue_name: string;
    match_date: string;
  }>) {
    const existing = seen.get(md.id);
    if (existing) {
      existing.venueName = md.venue_name;
      existing.matchDate = md.match_date;
    }
  }
  return Array.from(seen.values()).sort((a, b) =>
    a.matchDate < b.matchDate ? 1 : -1,
  );
}

type SanctionJoinRow = {
  id: string;
  case_id: string;
  sanction_type: string;
  magnitude: number;
  effective_from: string;
  notes: string | null;
  deleted_at: string | null;
  revoked_at: string | null;
  disciplinary_cases:
    | { id: string; incident_type: string; player_id: string }
    | Array<{ id: string; incident_type: string; player_id: string }>
    | null;
};

function humanizeToken(tok: string): string {
  return tok
    .split("_")
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * Sanctions issued AGAINST the user — reads disciplinary_actions joined to
 * disciplinary_cases (whose `player_id` is the sanctioned player). Returns
 * rows flattened into pickable options with a compact label.
 */
export async function listSanctionsForUser(
  sb: SupabaseClient,
  userId: string,
  limit = 30,
): Promise<SanctionOption[]> {
  const playerId = await resolvePlayerId(sb, userId);
  if (!playerId) return [];

  const { data, error } = await sb
    .from("disciplinary_actions")
    .select(
      `
      id, case_id, sanction_type, magnitude, effective_from, notes,
      deleted_at, revoked_at,
      disciplinary_cases:case_id ( id, incident_type, player_id )
      `,
    )
    .is("deleted_at", null)
    .is("revoked_at", null)
    .order("effective_from", { ascending: false })
    .limit(200);
  if (error) throw new Error(`listSanctionsForUser: ${error.message}`);

  const rows = ((data ?? []) as unknown) as SanctionJoinRow[];
  const mine = rows.filter((r) => {
    const kase = pickOne(r.disciplinary_cases);
    return kase?.player_id === playerId;
  });

  return mine.slice(0, limit).map((r) => {
    const kase = pickOne(r.disciplinary_cases);
    const incident = kase?.incident_type ?? "other";
    const sanction = r.sanction_type;
    const magnitudeBit =
      sanction === "warning" || r.magnitude === 0
        ? ""
        : ` (${r.magnitude})`;
    const label = `${humanizeToken(incident)} · ${humanizeToken(
      sanction,
    )}${magnitudeBit} · ${r.effective_from}`;
    return {
      id: r.id,
      caseId: r.case_id,
      incidentType: incident,
      sanctionType: sanction,
      magnitude: r.magnitude,
      effectiveFrom: r.effective_from,
      notes: r.notes,
      label,
    };
  });
}
