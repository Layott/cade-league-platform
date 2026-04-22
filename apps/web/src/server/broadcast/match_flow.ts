import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePermAsync, type PermissionError } from "@/lib/perms-db";
import type { Actor } from "@/perms";
import { publish } from "./realtime";
import { REALTIME } from "@/server/overlays/registry";
import {
  buildScoreBugFromMatch,
  type MatchLite,
  type MatchPlayerLite,
} from "@/server/overlays/autofill";
import { triggerOverlay, getActiveForTemplate } from "./events";
import {
  setClock,
  resetClock,
  getClock,
} from "@/server/overlays/match_clock";

/**
 * Plan 42 — match-flow orchestration for the broadcast control panel.
 *
 * startMatch pins a `matches.id` onto `stream_sessions.current_match_id`,
 * flips the match `scheduled → in_progress`, spawns a score_bug overlay
 * auto-filled from the two players, initializes a stopped match_clock,
 * and broadcasts `match.started`.
 *
 * updateScoreBug mutates the current score_bug payload (home/away ±1 or
 * reset) and republishes the payload on the session channel alongside a
 * dedicated `score.changed` event.
 *
 * endMatch writes the final `match_results` row, flips the match to
 * `completed`, clears `current_match_id`, and broadcasts `match.ended`.
 *
 * Every public entry point requires `broadcast.match_control`.
 */

const PERM_MATCH_CONTROL = "broadcast.match_control";
const SCORE_BUG_KEY = "score_bug";

export type SelectableMatch = {
  id: string;
  matchDayId: string;
  matchDate: string | null;
  scheduledTime: string | null;
  status: "scheduled" | "in_progress" | "completed" | "forfeited" | "voided";
  isToday: boolean;
  home: MatchPlayerLite;
  away: MatchPlayerLite;
};

export type ListOpts = {
  /** 'today' → only matches whose match_day.match_date = today's WAT date.
   *  'all'   → all active-season matches regardless of date. */
  scope?: "today" | "all";
};

type PlayerRow = {
  id: string;
  gamer_tag: string | null;
  jersey_number: number | null;
  users: { display_name: string | null } | null;
};

type MatchJoinRow = {
  id: string;
  match_day_id: string;
  scheduled_time: string | null;
  status: string;
  match_day: { match_date: string | null } | null;
  home_player: PlayerRow | null;
  away_player: PlayerRow | null;
};

function toPlayerLite(p: PlayerRow | null): MatchPlayerLite {
  if (!p) {
    return { id: "", gamerTag: null, displayName: null, jerseyNumber: null };
  }
  return {
    id: p.id,
    gamerTag: p.gamer_tag,
    displayName: p.users?.display_name ?? null,
    jerseyNumber: p.jersey_number,
  };
}

function toMatchLite(row: MatchJoinRow): MatchLite {
  return {
    id: row.id,
    homePlayer: row.home_player ? toPlayerLite(row.home_player) : null,
    awayPlayer: row.away_player ? toPlayerLite(row.away_player) : null,
  };
}

async function resolveActiveSeasonId(sb: SupabaseClient): Promise<string | null> {
  const { data } = await sb
    .from("seasons")
    .select("id")
    .eq("status", "active")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

function todayIsoDateInWat(): string {
  // Match the repo-wide WAT convention. No DST — UTC+1 fixed.
  const nowUtcMs = Date.now();
  const watMs = nowUtcMs + 60 * 60 * 1000;
  return new Date(watMs).toISOString().slice(0, 10);
}

/**
 * Returns the list of matches the admin can select on the broadcast panel.
 * When scope='today' the query filters to the current WAT date via the
 * joined match_day. When scope='all' it returns every match in the active
 * season. Perm: broadcast.match_control.
 */
export async function listSelectableMatches(
  sb: SupabaseClient,
  sessionId: string,
  opts: ListOpts = {},
  actor?: Actor,
): Promise<SelectableMatch[]> {
  if (actor) await requirePermAsync(sb, actor, PERM_MATCH_CONTROL);
  const scope = opts.scope ?? "today";

  // Session exists + resolve match_day for "today" scope.
  const { data: sessRaw } = await sb
    .from("stream_sessions")
    .select("id, match_day_id")
    .eq("id", sessionId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!sessRaw) return [];

  const seasonId = await resolveActiveSeasonId(sb);
  if (!seasonId) return [];

  const today = todayIsoDateInWat();

  const baseQuery = sb
    .from("matches")
    .select(
      `
      id,
      match_day_id,
      scheduled_time,
      status,
      match_day:match_day_id (
        match_date
      ),
      home_player:home_player_id (
        id,
        gamer_tag,
        jersey_number,
        users:users!players_user_id_fkey ( display_name )
      ),
      away_player:away_player_id (
        id,
        gamer_tag,
        jersey_number,
        users:users!players_user_id_fkey ( display_name )
      )
      `,
    )
    .eq("season_id", seasonId)
    .is("deleted_at", null)
    .order("scheduled_time", { ascending: true, nullsFirst: false });

  const query =
    scope === "today"
      ? baseQuery.eq("match_day_id", (sessRaw as { match_day_id: string }).match_day_id)
      : baseQuery;

  const { data } = await query;
  const rows = (data ?? []) as unknown as MatchJoinRow[];

  return rows.map((r) => {
    const matchDate = r.match_day?.match_date ?? null;
    return {
      id: r.id,
      matchDayId: r.match_day_id,
      matchDate,
      scheduledTime: r.scheduled_time,
      status: r.status as SelectableMatch["status"],
      isToday: matchDate === today,
      home: toPlayerLite(r.home_player),
      away: toPlayerLite(r.away_player),
    };
  });
}

async function loadMatchForFlow(
  sb: SupabaseClient,
  matchId: string,
): Promise<MatchJoinRow | null> {
  const { data } = await sb
    .from("matches")
    .select(
      `
      id,
      match_day_id,
      scheduled_time,
      status,
      match_day:match_day_id (
        match_date
      ),
      home_player:home_player_id (
        id,
        gamer_tag,
        jersey_number,
        users:users!players_user_id_fkey ( display_name )
      ),
      away_player:away_player_id (
        id,
        gamer_tag,
        jersey_number,
        users:users!players_user_id_fkey ( display_name )
      )
      `,
    )
    .eq("id", matchId)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as MatchJoinRow | null) ?? null;
}

/**
 * Plan 42 — startMatch.
 *
 * Idempotent if the supplied match is already the session's current match:
 * re-runs re-publish a fresh score_bug payload but do not write a new
 * match_results row or double-flip the match status.
 *
 * Rejects when the session already has a DIFFERENT current_match_id —
 * callers must endMatch first. Perm: broadcast.match_control.
 */
export async function startMatch(
  sb: SupabaseClient,
  sessionId: string,
  matchId: string,
  actor: Actor,
): Promise<{ matchId: string; startedAt: string }> {
  await requirePermAsync(sb, actor, PERM_MATCH_CONTROL);

  // 1. Session + match must exist.
  const { data: sessRaw } = await sb
    .from("stream_sessions")
    .select("id, current_match_id, ended_at")
    .eq("id", sessionId)
    .is("deleted_at", null)
    .maybeSingle();
  const sess = sessRaw as
    | { id: string; current_match_id: string | null; ended_at: string | null }
    | null;
  if (!sess) throw new Error(`session not found: ${sessionId}`);
  if (sess.ended_at) throw new Error(`session already ended: ${sessionId}`);

  if (sess.current_match_id && sess.current_match_id !== matchId) {
    throw new Error(
      `session already has active match ${sess.current_match_id}; endMatch first`,
    );
  }

  const match = await loadMatchForFlow(sb, matchId);
  if (!match) throw new Error(`match not found: ${matchId}`);

  const startedAt = new Date().toISOString();

  // 2. Pin the match on the session.
  {
    const { error } = await sb
      .from("stream_sessions")
      .update({
        current_match_id: matchId,
        match_started_at: startedAt,
        updated_at: startedAt,
      })
      .eq("id", sessionId);
    if (error) throw new Error(`pin current_match failed: ${error.message}`);
  }

  // 3. Flip match status → in_progress if it was scheduled.
  if (match.status === "scheduled") {
    const { error } = await sb
      .from("matches")
      .update({ status: "in_progress", updated_at: startedAt })
      .eq("id", matchId)
      .eq("status", "scheduled");
    if (error) throw new Error(`match status flip failed: ${error.message}`);
  }

  // 4. Spawn / replace score_bug overlay pre-filled from the match.
  const scoreBugPayload = buildScoreBugFromMatch(toMatchLite(match));
  if (scoreBugPayload) {
    // Clear any existing live score_bug first so the new event is the single
    // active row. `triggerOverlay` always inserts a new event row.
    const existing = await getActiveForTemplate(sb, sessionId, SCORE_BUG_KEY);
    if (existing) {
      const { error } = await sb
        .from("overlay_events")
        .update({ cleared_at: startedAt })
        .eq("id", existing.id)
        .is("cleared_at", null);
      if (error) {
        throw new Error(`clear existing score_bug failed: ${error.message}`);
      }
    }
    await triggerOverlay(sb, {
      sessionId,
      templateKey: SCORE_BUG_KEY,
      payload: scoreBugPayload,
      userId: actor.userId ?? "",
    });
  }

  // 5. Initialize the match_clock at 0 / stopped.
  await resetClock(sb, sessionId, actor.userId ?? "");

  // 6. Broadcast `match.started`.
  try {
    await publish(sb, sessionId, REALTIME.eventMatchStarted, {
      matchId,
      startedAt,
      home: scoreBugPayload?.players[0] ?? null,
      away: scoreBugPayload?.players[1] ?? null,
    });
  } catch {
    // swallow — durable rows already written.
  }

  return { matchId, startedAt };
}

export type ScoreDelta = {
  homeDelta?: number;
  awayDelta?: number;
  reset?: boolean;
};

/**
 * Plan 42 — updateScoreBug.
 *
 * Reads the active score_bug overlay_events row, applies a ±1 delta per
 * side (clamped ≥0) OR a full reset to 0-0, and re-triggers the overlay so
 * subscribers receive the new payload via `overlay.triggered`. Also emits
 * a `score.changed` event for dedicated consumers (match-card UIs etc).
 */
export async function updateScoreBug(
  sb: SupabaseClient,
  sessionId: string,
  delta: ScoreDelta,
  actor: Actor,
): Promise<{ home: number; away: number }> {
  await requirePermAsync(sb, actor, PERM_MATCH_CONTROL);

  const { data: sessRaw } = await sb
    .from("stream_sessions")
    .select("id, current_match_id, ended_at")
    .eq("id", sessionId)
    .is("deleted_at", null)
    .maybeSingle();
  const sess = sessRaw as
    | { id: string; current_match_id: string | null; ended_at: string | null }
    | null;
  if (!sess) throw new Error(`session not found: ${sessionId}`);
  if (sess.ended_at) throw new Error(`session already ended: ${sessionId}`);
  if (!sess.current_match_id) {
    throw new Error(`no current_match for session ${sessionId}`);
  }

  const existing = await getActiveForTemplate(sb, sessionId, SCORE_BUG_KEY);
  if (!existing) {
    throw new Error(`no active score_bug to update for session ${sessionId}`);
  }

  const payload = existing.payload as {
    players: Array<{
      displayName: string;
      photoUrl?: string;
      score: number;
    }>;
    matchId?: string;
  };

  if (!Array.isArray(payload.players) || payload.players.length !== 2) {
    throw new Error(`score_bug payload malformed for session ${sessionId}`);
  }

  const home = payload.players[0];
  const away = payload.players[1];

  let homeScore = home.score;
  let awayScore = away.score;
  if (delta.reset) {
    homeScore = 0;
    awayScore = 0;
  } else {
    if (delta.homeDelta) homeScore = Math.max(0, homeScore + delta.homeDelta);
    if (delta.awayDelta) awayScore = Math.max(0, awayScore + delta.awayDelta);
  }
  // score field bounds are 0..99 in the Zod schema — clamp upper too.
  homeScore = Math.min(99, homeScore);
  awayScore = Math.min(99, awayScore);

  const nextPayload = {
    players: [
      { ...home, score: homeScore },
      { ...away, score: awayScore },
    ],
    matchId: payload.matchId ?? sess.current_match_id,
  };

  // Clear old event + trigger new one so the single-active overlay contract
  // stays intact. triggerOverlay validates + inserts + publishes
  // overlay.triggered.
  {
    const now = new Date().toISOString();
    const { error } = await sb
      .from("overlay_events")
      .update({ cleared_at: now })
      .eq("id", existing.id)
      .is("cleared_at", null);
    if (error) throw new Error(`clear old score_bug failed: ${error.message}`);
  }
  await triggerOverlay(sb, {
    sessionId,
    templateKey: SCORE_BUG_KEY,
    payload: nextPayload,
    userId: actor.userId ?? "",
  });

  // Dedicated score.changed event — secondary signal for non-overlay
  // consumers. Overlay pages already received overlay.triggered above.
  try {
    await publish(sb, sessionId, REALTIME.eventScoreChanged, {
      matchId: sess.current_match_id,
      homeScore,
      awayScore,
    });
  } catch {
    // swallow
  }

  return { home: homeScore, away: awayScore };
}

export type FinalScores = {
  homeScore: number;
  awayScore: number;
  notes?: string | null;
};

/**
 * Plan 42 — endMatch.
 *
 * Writes the final `match_results` row (result_type='normal'), flips the
 * match to `completed`, clears `current_match_id` on the session, resets
 * the match_clock, and broadcasts `match.ended`. When a result already
 * exists it is updated in place instead of inserted (idempotent re-ends
 * after admin correction). Perm: broadcast.match_control.
 */
export async function endMatch(
  sb: SupabaseClient,
  sessionId: string,
  finalScores: FinalScores,
  actor: Actor,
): Promise<{ matchId: string; endedAt: string }> {
  await requirePermAsync(sb, actor, PERM_MATCH_CONTROL);

  if (!Number.isInteger(finalScores.homeScore) || finalScores.homeScore < 0) {
    throw new Error("homeScore must be a non-negative integer");
  }
  if (!Number.isInteger(finalScores.awayScore) || finalScores.awayScore < 0) {
    throw new Error("awayScore must be a non-negative integer");
  }

  const { data: sessRaw } = await sb
    .from("stream_sessions")
    .select("id, current_match_id")
    .eq("id", sessionId)
    .is("deleted_at", null)
    .maybeSingle();
  const sess = sessRaw as
    | { id: string; current_match_id: string | null }
    | null;
  if (!sess) throw new Error(`session not found: ${sessionId}`);
  if (!sess.current_match_id) {
    throw new Error(`no current_match on session ${sessionId}`);
  }
  const matchId = sess.current_match_id;
  const endedAt = new Date().toISOString();

  // 1. Upsert match_results. There is a unique constraint on match_id so we
  //    check first and either update or insert.
  const { data: existingResult } = await sb
    .from("match_results")
    .select("id")
    .eq("match_id", matchId)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingResult) {
    const { error } = await sb
      .from("match_results")
      .update({
        home_score: finalScores.homeScore,
        away_score: finalScores.awayScore,
        notes: finalScores.notes ?? null,
        updated_at: endedAt,
      })
      .eq("id", (existingResult as { id: string }).id);
    if (error) throw new Error(`match_result update failed: ${error.message}`);
  } else {
    const { error } = await sb
      .from("match_results")
      .insert({
        match_id: matchId,
        home_score: finalScores.homeScore,
        away_score: finalScores.awayScore,
        result_type: "normal",
        entered_by: actor.userId ?? "",
        notes: finalScores.notes ?? null,
      });
    if (error) throw new Error(`match_result insert failed: ${error.message}`);
  }

  // 2. Flip match → completed (when not already).
  {
    const { error } = await sb
      .from("matches")
      .update({ status: "completed", updated_at: endedAt })
      .eq("id", matchId)
      .neq("status", "completed");
    if (error) throw new Error(`match completed flip failed: ${error.message}`);
  }

  // 3. Clear current_match on the session.
  {
    const { error } = await sb
      .from("stream_sessions")
      .update({ current_match_id: null, updated_at: endedAt })
      .eq("id", sessionId);
    if (error) throw new Error(`clear current_match failed: ${error.message}`);
  }

  // 4. Clear any active score_bug overlay event — the ladder / standings
  //    recompute is handled by the match_results trigger.
  const existingBug = await getActiveForTemplate(sb, sessionId, SCORE_BUG_KEY);
  if (existingBug) {
    const { error } = await sb
      .from("overlay_events")
      .update({ cleared_at: endedAt })
      .eq("id", existingBug.id)
      .is("cleared_at", null);
    if (error) throw new Error(`clear score_bug failed: ${error.message}`);
  }

  // 5. Stop the clock.
  try {
    // Only reset if a clock exists; keep best-effort.
    if (await getClock(sb, sessionId)) {
      await setClock(sb, sessionId, {
        mode: "stopped",
        secondsRemaining: 0,
        userId: actor.userId ?? "",
      });
    }
  } catch {
    // swallow — durable writes above already committed.
  }

  // 6. Broadcast `match.ended`.
  try {
    await publish(sb, sessionId, REALTIME.eventMatchEnded, {
      matchId,
      endedAt,
      result: {
        homeScore: finalScores.homeScore,
        awayScore: finalScores.awayScore,
      },
    });
  } catch {
    // swallow
  }

  return { matchId, endedAt };
}

// Typed error re-export so callers don't need a second perms-db import.
export type { PermissionError };
