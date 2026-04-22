import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Plan 45 — list today's un-played matches for an "Up Next" picker.
 *
 * Returns every match on the broadcast session's `match_day` where:
 *   - `matches.status IN ('scheduled', 'in_progress')`
 *   - no confirmed `match_results` row exists (i.e. not yet completed)
 *   - not soft-deleted
 *
 * Falls back gracefully: when the session has no match_day pin, returns [].
 * The result rows carry enough to auto-fill the up_next_bug payload
 * (kickoffAt ISO + home/away player display names).
 */

export type UnplayedMatch = {
  id: string;
  matchDayId: string;
  matchDate: string | null;
  scheduledTime: string | null;
  /** ISO timestamp assembled from matchDate + scheduledTime. `null` when the
   *  match_day has no date (shouldn't normally happen). */
  kickoffAt: string | null;
  home: {
    id: string | null;
    displayName: string | null;
    gamerTag: string | null;
  };
  away: {
    id: string | null;
    displayName: string | null;
    gamerTag: string | null;
  };
  status: "scheduled" | "in_progress";
};

type MatchRow = {
  id: string;
  match_day_id: string;
  scheduled_time: string | null;
  status: string;
  match_day: { match_date: string | null } | null;
  home_player: {
    id: string;
    gamer_tag: string | null;
    users: { display_name: string | null } | null;
  } | null;
  away_player: {
    id: string;
    gamer_tag: string | null;
    users: { display_name: string | null } | null;
  } | null;
  match_results: { id: string }[] | null;
};

function kickoffIso(matchDate: string | null, scheduledTime: string | null): string | null {
  if (!matchDate) return null;
  const t = scheduledTime ?? "00:00:00";
  const parsed = new Date(`${matchDate}T${t}Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/**
 * List un-played matches on today's match_day (as pinned on the session).
 *
 * We intentionally do NOT hit Today's calendar date — we read the session's
 * `match_day_id` so the admin's picker shows rows for the match day they're
 * broadcasting (which may slip to the next calendar day on a late finish).
 */
export async function listUnplayedMatchesToday(
  sb: SupabaseClient,
  sessionId: string,
): Promise<UnplayedMatch[]> {
  const { data: sessRaw } = await sb
    .from("stream_sessions")
    .select("id, match_day_id")
    .eq("id", sessionId)
    .is("deleted_at", null)
    .maybeSingle();
  const sess = sessRaw as { id: string; match_day_id: string } | null;
  if (!sess) return [];

  const { data } = await sb
    .from("matches")
    .select(
      `
      id,
      match_day_id,
      scheduled_time,
      status,
      match_day:match_day_id ( match_date ),
      home_player:home_player_id (
        id,
        gamer_tag,
        users:users!players_user_id_fkey ( display_name )
      ),
      away_player:away_player_id (
        id,
        gamer_tag,
        users:users!players_user_id_fkey ( display_name )
      ),
      match_results ( id )
      `,
    )
    .eq("match_day_id", sess.match_day_id)
    .in("status", ["scheduled", "in_progress"])
    .is("deleted_at", null)
    .order("scheduled_time", { ascending: true, nullsFirst: false });

  const rows = (data ?? []) as unknown as MatchRow[];

  // Filter out rows that already have a completed match_results entry — the
  // DB-level status column should already reflect this but we re-check in JS
  // to cover the race window between result insert + status flip.
  const unplayed = rows.filter((r) => {
    const results = r.match_results ?? [];
    return results.length === 0;
  });

  return unplayed.map((r) => ({
    id: r.id,
    matchDayId: r.match_day_id,
    matchDate: r.match_day?.match_date ?? null,
    scheduledTime: r.scheduled_time,
    kickoffAt: kickoffIso(r.match_day?.match_date ?? null, r.scheduled_time),
    home: {
      id: r.home_player?.id ?? null,
      displayName: r.home_player?.users?.display_name ?? null,
      gamerTag: r.home_player?.gamer_tag ?? null,
    },
    away: {
      id: r.away_player?.id ?? null,
      displayName: r.away_player?.users?.display_name ?? null,
      gamerTag: r.away_player?.gamer_tag ?? null,
    },
    status: r.status as "scheduled" | "in_progress",
  }));
}
