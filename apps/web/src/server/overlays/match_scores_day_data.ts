import type { SupabaseClient } from "@supabase/supabase-js";
import { REALTIME } from "./registry";
import {
  matchScoresDaySchema,
  type MatchScoresDayPayload,
} from "./schemas";
import { formatWat } from "@/lib/time";

/**
 * Audit Slice 1 (2026-04-24) — server reader for `/overlay/match-scores-day`.
 *
 * Data source
 * -----------
 * The overlay shows one row per match on the "current" match_day, with:
 *   - home + away display names
 *   - final score for completed matches (from match_results)
 *   - LIVE placeholder score for in-progress matches (read from the
 *     stream_sessions pinned match + its active score_bug overlay event)
 *   - scheduled rows for matches not yet played (score = null)
 *
 * Two entry points:
 *   - `fetchMatchScoresDayDataBySession(sb, sessionId)` — resolves the
 *     session's `match_day_id` and pulls all matches on that day. Used
 *     when the overlay is driven by a broadcast session.
 *   - `fetchMatchScoresDayData(sb, matchDayId)` — fetches by explicit
 *     match_day_id. Used for tests + direct admin links.
 *
 * Realtime
 * --------
 * Because this overlay mixes session-aware (LIVE) + season-aware
 * (completed scores) data, it subscribes to TWO channels:
 *   1. `public:standings:<seasonId>` for `standings.changed` — fired by
 *      recompute_standings after every match_results write.
 *   2. `overlay:<sessionId>` for `score.changed` + `match.ended` +
 *      `match.started` — fired by match_flow for in-progress LIVE rows.
 *
 * The caller (overlay page) reuses both channel names returned in
 * `MatchScoresDayData.channels`.
 */

export type MatchScoreRow = {
  match_id: string;
  home: string;
  away: string;
  /**
   * Canonical headshot slug for the home / away player, derived from
   * `players.gamer_tag` (or display-name fallback). Used by the
   * `11-match-scores-day` overlay HTML to resolve `processed/<slug>/`
   * folder. Empty string when no slug can be derived.
   */
  home_slug: string;
  away_slug: string;
  home_score: number | null;
  away_score: number | null;
  status: "scheduled" | "in_progress" | "completed";
  scheduled_time: string | null;
};

export type MatchScoresDayData = {
  matchDayId: string;
  seasonId: string | null;
  matchDate: string | null;
  venueName: string | null;
  /** Display label like "Match Day 5 — Fri May 2" */
  label: string;
  /**
   * Bug 1 fix (2026-04-26) — 1-based position of this match day within its
   * season, computed from `match_date ASC` order across all sibling
   * match_days. Used by the v2 11-match-scores-day overlay to render
   * "MATCH DAY N RESULTS" in the title bar. Null when the season has
   * zero match_days (defensive).
   */
  sequenceNumber: number | null;
  rows: MatchScoreRow[];
  channels: {
    standings: string | null;
    session: string | null;
  };
};

function deriveLabel(matchDate: string | null, venueName: string | null): string {
  if (!matchDate) return venueName ?? "Match Day";
  const formatted = formatWat(`${matchDate}T00:00:00Z`, "EEE MMM d");
  if (venueName) return `${formatted} · ${venueName}`;
  return formatted;
}

/**
 * Bug 1 fix (2026-04-26) — match_days has no `sequence_number` column.
 * Derive the 1-based position of THIS match day within its season by
 * counting all match_days with the same `season_id` ordered by
 * `match_date ASC` and finding our row's index. Used to render
 * "MATCH DAY N RESULTS" in the overlay title bar instead of a hardcoded
 * "5". Returns null when the season has zero match_days (shouldn't
 * happen in practice but defensive).
 */
async function deriveSequenceNumber(
  sb: SupabaseClient,
  matchDayId: string,
  seasonId: string,
): Promise<number | null> {
  try {
    const { data, error } = await sb
      .from("match_days")
      .select("id, match_date")
      .eq("season_id", seasonId)
      .is("deleted_at", null)
      .order("match_date", { ascending: true });
    if (error || !data || !Array.isArray(data)) return null;
    const idx = (data as { id: string }[]).findIndex(
      (r) => r.id === matchDayId,
    );
    if (idx < 0) return null;
    return idx + 1;
  } catch {
    return null;
  }
}

type SessionRow = {
  id: string;
  match_day_id: string;
  primary_match_id: string | null;
  secondary_match_id: string | null;
  current_match_id: string | null;
};

type MatchRowDb = {
  id: string;
  scheduled_time: string | null;
  status: string;
  home_player: {
    gamer_tag: string | null;
    users: { display_name: string | null } | null;
  } | null;
  away_player: {
    gamer_tag: string | null;
    users: { display_name: string | null } | null;
  } | null;
  match_results:
    | {
        home_score: number;
        away_score: number;
        result_type: string;
        confirmed_at: string | null;
      }[]
    | null;
};

type MatchDayRow = {
  id: string;
  match_date: string | null;
  venue_name: string | null;
  season_id: string;
};

function pickName(p: MatchRowDb["home_player"]): string {
  if (!p) return "—";
  return p.users?.display_name ?? p.gamer_tag ?? "—";
}

/**
 * Map a player's display name OR gamer_tag to the canonical asset-folder
 * slug under `KNOWLEDGE/brand-assets/players/processed/<slug>/`. Mirrors
 * the per-overlay NAME_TO_SLUG tables in the static HTMLs so server +
 * client agree on the headshot URL.
 */
const NAME_TO_SLUG: Readonly<Record<string, string>> = {
  ADEFOLA: "adefola",
  ANIFE: "anife",
  "BAJI JNR": "baji_jnr",
  DADABOI: "dadaboi",
  FARUK: "faruk",
  GURU: "guru",
  KAYKAY: "kaykay",
  "KILLER FREAK": "killer_freak",
  "KING NONEX": "kingnonex",
  KINGNONEX: "kingnonex",
  MITCH: "mitch",
  "MR OGA": "mr_oga",
  "MR. OGA": "mr_oga",
  TACTICAL: "tactical",
  WOLEVATION: "wolevation",
};
const SLUG_ALIAS: Readonly<Record<string, string>> = {
  king_nonex: "kingnonex",
};
function pickSlug(p: MatchRowDb["home_player"]): string {
  if (!p) return "";
  // Prefer gamer_tag (already slug-shaped), then map display_name via
  // NAME_TO_SLUG. Apply SLUG_ALIAS so `king_nonex` → `kingnonex`.
  const rawTag = (p.gamer_tag ?? "").toString().trim().toLowerCase();
  if (rawTag) {
    const compact = rawTag.replace(/[^a-z0-9]/g, "");
    if (SLUG_ALIAS[compact]) return SLUG_ALIAS[compact];
    if (SLUG_ALIAS[rawTag]) return SLUG_ALIAS[rawTag];
    return rawTag.replace(/[^a-z0-9]+/g, "_");
  }
  const rawName = (p.users?.display_name ?? "").toString().trim().toUpperCase();
  if (rawName && NAME_TO_SLUG[rawName]) return NAME_TO_SLUG[rawName];
  return "";
}

function pickResult(
  results: NonNullable<MatchRowDb["match_results"]>,
): {
  home_score: number;
  away_score: number;
  confirmed: boolean;
} | null {
  // Prefer confirmed non-void result; fall back to any non-void row for
  // LIVE rendering (admin may have written a draft result row which the
  // overlay still displays pre-confirmation).
  const nonVoid = results.filter((r) => r.result_type !== "void");
  const confirmed = nonVoid.find((r) => r.confirmed_at !== null);
  if (confirmed) {
    return {
      home_score: confirmed.home_score,
      away_score: confirmed.away_score,
      confirmed: true,
    };
  }
  const draft = nonVoid[0];
  if (draft) {
    return {
      home_score: draft.home_score,
      away_score: draft.away_score,
      confirmed: false,
    };
  }
  return null;
}

/**
 * Fetch match-day scores for a given match_day_id.
 * Returns rows ordered by `scheduled_time ASC` with nulls last.
 */
export async function fetchMatchScoresDayData(
  sb: SupabaseClient,
  matchDayId: string,
  opts: { sessionId?: string | null } = {},
): Promise<MatchScoresDayData> {
  const { data: mdData, error: mdErr } = await sb
    .from("match_days")
    .select("id, match_date, venue_name, season_id")
    .eq("id", matchDayId)
    .is("deleted_at", null)
    .maybeSingle();

  if (mdErr) {
    throw new Error(`fetchMatchScoresDayData md failed: ${mdErr.message}`);
  }
  const matchDay = (mdData as MatchDayRow | null) ?? null;
  if (!matchDay) {
    return {
      matchDayId,
      seasonId: null,
      matchDate: null,
      venueName: null,
      label: "Match Day",
      sequenceNumber: null,
      rows: [],
      channels: {
        standings: null,
        session: opts.sessionId
          ? REALTIME.channel(opts.sessionId)
          : null,
      },
    };
  }

  // Bug 1 (2026-04-26) — derive 1-based position within season so the
  // overlay title bar reads the SESSION'S match-day, not a hardcoded "5".
  const sequenceNumber = await deriveSequenceNumber(
    sb,
    matchDayId,
    matchDay.season_id,
  );

  const { data: matchesRaw, error: matchErr } = await sb
    .from("matches")
    .select(
      `
      id,
      scheduled_time,
      status,
      home_player:home_player_id (
        gamer_tag,
        users:users!players_user_id_fkey ( display_name )
      ),
      away_player:away_player_id (
        gamer_tag,
        users:users!players_user_id_fkey ( display_name )
      ),
      match_results (
        home_score, away_score, result_type, confirmed_at
      )
      `,
    )
    .eq("match_day_id", matchDayId)
    .is("deleted_at", null)
    .order("scheduled_time", { ascending: true, nullsFirst: false });

  if (matchErr) {
    throw new Error(
      `fetchMatchScoresDayData matches failed: ${matchErr.message}`,
    );
  }

  const rawRows = (matchesRaw ?? []) as unknown as MatchRowDb[];

  const rows: MatchScoreRow[] = rawRows.map((m) => {
    // Supabase may return one-row relations as object instead of array.
    // Normalize to array first.
    const rawResults = Array.isArray(m.match_results)
      ? m.match_results
      : (m.match_results ? [m.match_results] : []);
    const results = rawResults.filter((r) => r.result_type !== "void");
    const r = pickResult(results);
    let status: "scheduled" | "in_progress" | "completed" = "scheduled";
    if (m.status === "completed" || r?.confirmed) {
      status = "completed";
    } else if (m.status === "in_progress") {
      status = "in_progress";
    } else if (m.status === "forfeited") {
      status = "completed";
    } else if (m.status === "voided") {
      // void rows still show but with null scores.
      status = "scheduled";
    }
    return {
      match_id: m.id,
      home: pickName(m.home_player),
      away: pickName(m.away_player),
      home_slug: pickSlug(m.home_player),
      away_slug: pickSlug(m.away_player),
      home_score: r ? r.home_score : null,
      away_score: r ? r.away_score : null,
      status,
      scheduled_time: m.scheduled_time,
    };
  });

  return {
    matchDayId,
    seasonId: matchDay.season_id,
    matchDate: matchDay.match_date,
    venueName: matchDay.venue_name,
    label: deriveLabel(matchDay.match_date, matchDay.venue_name),
    sequenceNumber,
    rows,
    channels: {
      standings: REALTIME.standingsChannel(matchDay.season_id),
      session: opts.sessionId ? REALTIME.channel(opts.sessionId) : null,
    },
  };
}

/**
 * Fetch by session id — resolves `match_day_id` from `stream_sessions`
 * and delegates. Convenience wrapper for overlay SSR when the only id
 * available is the session.
 *
 * Returns null when the session is unknown or soft-deleted.
 */
export async function fetchMatchScoresDayDataBySession(
  sb: SupabaseClient,
  sessionId: string,
): Promise<MatchScoresDayData | null> {
  const { data: sessRaw, error: sessErr } = await sb
    .from("stream_sessions")
    .select(
      "id, match_day_id, primary_match_id, secondary_match_id, current_match_id",
    )
    .eq("id", sessionId)
    .is("deleted_at", null)
    .maybeSingle();
  if (sessErr) {
    throw new Error(
      `fetchMatchScoresDayDataBySession failed: ${sessErr.message}`,
    );
  }
  const sess = (sessRaw as SessionRow | null) ?? null;
  if (!sess) return null;
  return fetchMatchScoresDayData(sb, sess.match_day_id, {
    sessionId: sess.id,
  });
}

/**
 * Map DB data to a schema-valid `MatchScoresDayPayload`.
 *
 * Bug 1 fix (2026-04-26) — `matchDayLabel` is now derived from the
 * 1-based `sequenceNumber` (e.g. "MATCH DAY 1 RESULTS") so the overlay
 * title bar reads the session's actual match-day, not a hardcoded "5"
 * from the static demo HTML. Falls back to the date+venue string when
 * sequence cannot be derived.
 */
export function toMatchScoresDayPayload(
  data: MatchScoresDayData,
): MatchScoresDayPayload {
  const titleLabel = data.sequenceNumber
    ? `MATCH DAY ${data.sequenceNumber} RESULTS`
    : data.label;
  return matchScoresDaySchema.parse({
    matchDayLabel: titleLabel,
    rows: data.rows.map((r) => ({
      home: r.home,
      away: r.away,
      homeSlug: r.home_slug || undefined,
      awaySlug: r.away_slug || undefined,
      homeScore: r.home_score,
      awayScore: r.away_score,
      status: r.status,
    })),
  });
}
