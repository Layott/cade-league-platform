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
import { triggerOverlay, listActiveOverlays } from "./events";
import {
  setClock,
  resetClock,
  getClock,
} from "@/server/overlays/match_clock";

/**
 * Plan 42 / 42.1 — match-flow orchestration for the broadcast control panel.
 *
 * Plan 42.1 extension: CADE broadcasts TWO concurrent matches — a
 * `primary` match on-stream and a `secondary` match off-stream. Every
 * entry point now takes a `slot: 'primary' | 'secondary'` parameter and
 * writes to the matching `<slot>_match_id` column on `stream_sessions`.
 *
 * Score-bug mechanics: a single score_bug overlay_events row is kept
 * active PER SLOT, discriminated by the `slot` field on its payload.
 * Subscribing overlay pages filter incoming events by the URL's
 * `?slot=primary|secondary` (default primary) so both slots can render
 * independently on two browser sources.
 *
 * Every public entry point requires `broadcast.match_control`.
 */

const PERM_MATCH_CONTROL = "broadcast.match_control";
const SCORE_BUG_KEY = "score_bug";

export type MatchSlot = "primary" | "secondary";

function slotColumns(slot: MatchSlot): {
  matchCol: "primary_match_id" | "secondary_match_id";
  startedCol: "primary_match_started_at" | "secondary_match_started_at";
} {
  return slot === "primary"
    ? {
        matchCol: "primary_match_id",
        startedCol: "primary_match_started_at",
      }
    : {
        matchCol: "secondary_match_id",
        startedCol: "secondary_match_started_at",
      };
}

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
 * Plan 42.1 — find the current active score_bug overlay_events row whose
 * payload.slot matches the given slot. Single query via listActiveOverlays
 * to keep the scan narrow (we only care about the score_bug template).
 */
async function findScoreBugForSlot(
  sb: SupabaseClient,
  sessionId: string,
  slot: MatchSlot,
): Promise<{ id: string; payload: Record<string, unknown> } | null> {
  const active = await listActiveOverlays(sb, sessionId);
  const match = active.find(
    (a) =>
      a.template_key === SCORE_BUG_KEY &&
      (a.payload as { slot?: string } | null)?.slot === slot,
  );
  if (!match) return null;
  return { id: match.id, payload: match.payload };
}

/**
 * Plan 42.2 — ensureScoreBug. Lazily seeds a score_bug row for a slot when
 * the admin clicks +1 / -1 / reset before the startMatch path had a chance
 * to create one (e.g. the `startMatch` call was never fired for this
 * match, or an earlier clear removed the row without re-inserting).
 *
 * Behavior:
 *   - If an active row already exists for the slot, returns it untouched.
 *   - Otherwise, requires the slot to have a pinned matchId. Fetches the
 *     match's home/away display names, builds a 0-0 payload via
 *     buildScoreBugFromMatch(), triggers a new overlay_events row, and
 *     refetches the freshly-inserted row so the caller can apply deltas
 *     to it in the same call.
 *   - If no match is pinned for the slot, returns null so the caller can
 *     raise `no current_match` — the existing guard.
 */
async function ensureScoreBug(
  sb: SupabaseClient,
  sessionId: string,
  slot: MatchSlot,
  slotMatchId: string,
  actor: Actor,
): Promise<{ id: string; payload: Record<string, unknown> } | null> {
  // Fast path — row already exists.
  const existing = await findScoreBugForSlot(sb, sessionId, slot);
  if (existing) return existing;

  // Lazy auto-create. Need the match's player names to seed the payload.
  const match = await loadMatchForFlow(sb, slotMatchId);
  if (!match) return null; // caller raises 'no current_match for ... slot'

  const scoreBugBase = buildScoreBugFromMatch(toMatchLite(match));
  if (!scoreBugBase) return null;

  const seeded: Record<string, unknown> = { ...scoreBugBase, slot };
  await triggerOverlay(sb, {
    sessionId,
    templateKey: SCORE_BUG_KEY,
    payload: seeded,
    userId: actor.userId ?? "",
  });

  // Re-read so we pick up the inserted row's id (the caller will clear it
  // before re-triggering with the updated score payload).
  return findScoreBugForSlot(sb, sessionId, slot);
}

/**
 * Plan 42 / 42.1 — startMatch.
 *
 * Pins `matchId` onto `stream_sessions.<slot>_match_id`, flips the match
 * `scheduled → in_progress`, spawns a score_bug overlay auto-filled from
 * the two players (tagged with `slot` for per-slot subscription filtering),
 * initializes a stopped match_clock (shared across both slots), and
 * broadcasts `match.started` carrying the slot.
 *
 * Idempotent when the supplied match is already the slot's current match.
 * Rejects when the slot already holds a DIFFERENT match id — callers must
 * endMatch that slot first. The OTHER slot is untouched.
 *
 * Perm: broadcast.match_control.
 */
export async function startMatch(
  sb: SupabaseClient,
  sessionId: string,
  matchId: string,
  slot: MatchSlot,
  actor: Actor,
): Promise<{ matchId: string; slot: MatchSlot; startedAt: string }> {
  await requirePermAsync(sb, actor, PERM_MATCH_CONTROL);
  const { matchCol, startedCol } = slotColumns(slot);

  // 1. Session + match must exist.
  const { data: sessRaw } = await sb
    .from("stream_sessions")
    .select(
      "id, primary_match_id, secondary_match_id, ended_at",
    )
    .eq("id", sessionId)
    .is("deleted_at", null)
    .maybeSingle();
  const sess = sessRaw as
    | {
        id: string;
        primary_match_id: string | null;
        secondary_match_id: string | null;
        ended_at: string | null;
      }
    | null;
  if (!sess) throw new Error(`session not found: ${sessionId}`);
  if (sess.ended_at) throw new Error(`session already ended: ${sessionId}`);

  const existingForSlot =
    slot === "primary" ? sess.primary_match_id : sess.secondary_match_id;
  if (existingForSlot && existingForSlot !== matchId) {
    throw new Error(
      `${slot} slot already has active match ${existingForSlot}; endMatch first`,
    );
  }

  const match = await loadMatchForFlow(sb, matchId);
  if (!match) throw new Error(`match not found: ${matchId}`);

  const startedAt = new Date().toISOString();

  // 2. Pin the match on the given slot.
  {
    const update: Record<string, unknown> = {
      [matchCol]: matchId,
      [startedCol]: startedAt,
      updated_at: startedAt,
    };
    const { error } = await sb
      .from("stream_sessions")
      .update(update)
      .eq("id", sessionId);
    if (error) throw new Error(`pin ${slot}_match failed: ${error.message}`);
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

  // 4. Spawn / replace score_bug overlay FOR THIS SLOT. Clear any existing
  //    slot-tagged row first so the new event is the single active row per
  //    slot; the other slot's score_bug is untouched.
  const scoreBugBase = buildScoreBugFromMatch(toMatchLite(match));
  let scoreBugPayload: Record<string, unknown> | null = null;
  if (scoreBugBase) {
    scoreBugPayload = { ...scoreBugBase, slot };
    const existing = await findScoreBugForSlot(sb, sessionId, slot);
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

  // 5. Initialize the match_clock at 0 / stopped. The clock is shared
  //    across both slots per Plan 42.1 spec — only reset on first start
  //    to avoid stomping on an already-running clock for the other slot.
  const existingClock = await getClock(sb, sessionId);
  if (!existingClock) {
    await resetClock(sb, sessionId, actor.userId ?? "");
  }

  // 6. Broadcast `match.started`.
  try {
    await publish(sb, sessionId, REALTIME.eventMatchStarted, {
      matchId,
      slot,
      startedAt,
      home:
        (scoreBugPayload?.players as Array<unknown> | undefined)?.[0] ?? null,
      away:
        (scoreBugPayload?.players as Array<unknown> | undefined)?.[1] ?? null,
    });
  } catch {
    // swallow — durable rows already written.
  }

  return { matchId, slot, startedAt };
}

export type ScoreDelta = {
  homeDelta?: number;
  awayDelta?: number;
  reset?: boolean;
};

/**
 * Plan 42 / 42.1 — updateScoreBug.
 *
 * Reads the active score_bug overlay_events row tagged with the given slot,
 * applies a ±1 delta per side (clamped 0..99) OR a full reset, and re-
 * triggers the overlay (preserving the `slot` field) so per-slot
 * subscribers receive the update via `overlay.triggered`. Also emits
 * `score.changed` carrying the slot.
 */
export async function updateScoreBug(
  sb: SupabaseClient,
  sessionId: string,
  slot: MatchSlot,
  delta: ScoreDelta,
  actor: Actor,
): Promise<{ home: number; away: number; slot: MatchSlot }> {
  await requirePermAsync(sb, actor, PERM_MATCH_CONTROL);

  const { data: sessRaw } = await sb
    .from("stream_sessions")
    .select(
      "id, primary_match_id, secondary_match_id, ended_at",
    )
    .eq("id", sessionId)
    .is("deleted_at", null)
    .maybeSingle();
  const sess = sessRaw as
    | {
        id: string;
        primary_match_id: string | null;
        secondary_match_id: string | null;
        ended_at: string | null;
      }
    | null;
  if (!sess) throw new Error(`session not found: ${sessionId}`);
  if (sess.ended_at) throw new Error(`session already ended: ${sessionId}`);
  const slotMatchId =
    slot === "primary" ? sess.primary_match_id : sess.secondary_match_id;
  if (!slotMatchId) {
    throw new Error(`no current_match for ${slot} slot on session ${sessionId}`);
  }

  // Plan 42.2 — lazy auto-create when the slot has a match pinned but no
  // score_bug overlay was seeded yet (e.g. admin never clicked Start match).
  // ensureScoreBug returns null only when the match row itself can't be
  // hydrated — safety net, caller never expects that path since we already
  // validated slotMatchId above.
  const existing = await ensureScoreBug(
    sb,
    sessionId,
    slot,
    slotMatchId,
    actor,
  );
  if (!existing) {
    throw new Error(
      `failed to seed score_bug for ${slot} slot on session ${sessionId} (match ${slotMatchId} missing?)`,
    );
  }

  const payload = existing.payload as {
    players: Array<{
      displayName: string;
      photoUrl?: string;
      score: number;
    }>;
    matchId?: string;
    slot?: string;
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
    matchId: payload.matchId ?? slotMatchId,
    slot,
  };

  // Clear old event + trigger new one so the single-active-per-slot
  // contract stays intact. triggerOverlay validates + inserts + publishes
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
      matchId: slotMatchId,
      slot,
      homeScore,
      awayScore,
    });
  } catch {
    // swallow
  }

  return { home: homeScore, away: awayScore, slot };
}

/**
 * Plan 45 — clearScoreBug.
 *
 * Clears the active score_bug overlay for the given slot WITHOUT touching the
 * underlying match row. Used by the "Trigger OFF" button on the structured
 * score_bug form when the producer wants to take the bug off-stream without
 * ending the match. Idempotent — if no active bug exists for the slot it
 * resolves silently. Broadcasts `instance.cleared` so overlay pages animate
 * out.
 */
export async function clearScoreBug(
  sb: SupabaseClient,
  sessionId: string,
  slot: MatchSlot,
  actor: Actor,
): Promise<{ slot: MatchSlot; cleared: boolean }> {
  await requirePermAsync(sb, actor, PERM_MATCH_CONTROL);

  const existing = await findScoreBugForSlot(sb, sessionId, slot);
  if (!existing) return { slot, cleared: false };

  const now = new Date().toISOString();
  const { error } = await sb
    .from("overlay_events")
    .update({ cleared_at: now })
    .eq("id", existing.id)
    .is("cleared_at", null);
  if (error) throw new Error(`clearScoreBug failed: ${error.message}`);

  try {
    await publish(sb, sessionId, REALTIME.eventCleared, {
      eventId: existing.id,
      templateKey: SCORE_BUG_KEY,
      slot,
    });
  } catch {
    // swallow
  }
  return { slot, cleared: true };
}

export type FinalScores = {
  homeScore: number;
  awayScore: number;
  notes?: string | null;
};

/**
 * Plan 42 / 42.1 — endMatch.
 *
 * Writes the final `match_results` row for the slot's current match
 * (result_type='normal'), flips that match to `completed`, clears ONLY the
 * named slot's `*_match_id` on the session, resets score_bug for the
 * slot, and broadcasts `match.ended`. The OTHER slot is untouched. When
 * both slots are cleared the clock is stopped; when the OTHER slot is
 * still active the clock keeps running.
 */
export async function endMatch(
  sb: SupabaseClient,
  sessionId: string,
  slot: MatchSlot,
  finalScores: FinalScores,
  actor: Actor,
): Promise<{ matchId: string; slot: MatchSlot; endedAt: string }> {
  await requirePermAsync(sb, actor, PERM_MATCH_CONTROL);

  if (!Number.isInteger(finalScores.homeScore) || finalScores.homeScore < 0) {
    throw new Error("homeScore must be a non-negative integer");
  }
  if (!Number.isInteger(finalScores.awayScore) || finalScores.awayScore < 0) {
    throw new Error("awayScore must be a non-negative integer");
  }

  const { matchCol, startedCol } = slotColumns(slot);

  const { data: sessRaw } = await sb
    .from("stream_sessions")
    .select(
      "id, primary_match_id, secondary_match_id",
    )
    .eq("id", sessionId)
    .is("deleted_at", null)
    .maybeSingle();
  const sess = sessRaw as
    | {
        id: string;
        primary_match_id: string | null;
        secondary_match_id: string | null;
      }
    | null;
  if (!sess) throw new Error(`session not found: ${sessionId}`);
  const slotMatchId =
    slot === "primary" ? sess.primary_match_id : sess.secondary_match_id;
  if (!slotMatchId) {
    throw new Error(`no current_match for ${slot} slot on session ${sessionId}`);
  }
  const matchId = slotMatchId;
  const endedAt = new Date().toISOString();

  // 1. Upsert match_results. Unique constraint on match_id → check then
  //    update / insert.
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

  // 3. Clear the NAMED slot only.
  {
    const update: Record<string, unknown> = {
      [matchCol]: null,
      [startedCol]: null,
      updated_at: endedAt,
    };
    const { error } = await sb
      .from("stream_sessions")
      .update(update)
      .eq("id", sessionId);
    if (error) throw new Error(`clear ${slot}_match failed: ${error.message}`);
  }

  // 4. Clear the slot-tagged score_bug (leave the other slot intact).
  const existingBug = await findScoreBugForSlot(sb, sessionId, slot);
  if (existingBug) {
    const { error } = await sb
      .from("overlay_events")
      .update({ cleared_at: endedAt })
      .eq("id", existingBug.id)
      .is("cleared_at", null);
    if (error) throw new Error(`clear score_bug failed: ${error.message}`);
  }

  // 5. Stop the clock ONLY when both slots are now empty.
  const otherSlotStillActive =
    slot === "primary"
      ? !!sess.secondary_match_id
      : !!sess.primary_match_id;
  if (!otherSlotStillActive) {
    try {
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
  }

  // 6. Broadcast `match.ended`.
  try {
    await publish(sb, sessionId, REALTIME.eventMatchEnded, {
      matchId,
      slot,
      endedAt,
      result: {
        homeScore: finalScores.homeScore,
        awayScore: finalScores.awayScore,
      },
    });
  } catch {
    // swallow
  }

  return { matchId, slot, endedAt };
}

// Typed error re-export so callers don't need a second perms-db import.
export type { PermissionError };
