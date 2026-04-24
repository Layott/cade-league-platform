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
      rows: [],
      channels: {
        standings: null,
        session: opts.sessionId
          ? REALTIME.channel(opts.sessionId)
          : null,
      },
    };
  }

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
    const results = (m.match_results ?? []).filter(
      (r) => r.result_type !== "void",
    );
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
 */
export function toMatchScoresDayPayload(
  data: MatchScoresDayData,
): MatchScoresDayPayload {
  return matchScoresDaySchema.parse({
    matchDayLabel: data.label,
    rows: data.rows.map((r) => ({
      home: r.home,
      away: r.away,
      homeScore: r.home_score,
      awayScore: r.away_score,
      status: r.status,
    })),
  });
}
