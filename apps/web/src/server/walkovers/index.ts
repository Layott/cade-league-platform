import type { SupabaseClient } from "@supabase/supabase-js";
import { publishWalkoverConfirmed } from "@/server/realtime/publishers/walkover_confirmed";
import { publishScoreChanged } from "@/server/realtime/publishers/score_changed";
import { publishMatchEnded } from "@/server/realtime/publishers/match_ended";

/**
 * Plan 51 — walkover orchestration.
 *
 * A walkover writes (or amends) a `match_results` row with `is_walkover=true`
 * and a 3-0 score in favour of the winner. There are two flavours:
 *
 *   - Admin-initiated: walkover is final the moment it's written. Score 3-0
 *     to the supplied winner, walkover_pending=false, walkover_confirmed_at
 *     stamped now().
 *   - Referee-initiated: walkover is provisional until an admin confirms.
 *     Score 3-0 to the OPPONENT of the absent player, walkover_pending=true,
 *     walkover_confirmed_at NULL. confirmRefPendingWalkover flips pending
 *     false + stamps confirmed_at; the score does not change because the
 *     referee already committed to it on the field.
 *
 * undoWalkover hard-removes the row. Standings recompute is downstream's
 * concern — the trigger on match_results fires recompute_standings() once
 * the row mutates, so we don't call the SQL fn here.
 *
 * The migration owner adds these columns:
 *   - is_walkover BOOLEAN
 *   - walkover_initiated_by TEXT CHECK (in 'admin','ref')
 *   - walkover_pending BOOLEAN
 *   - walkover_confirmed_at TIMESTAMPTZ
 *   - winner_player_id UUID  -- nullable, set on walkover rows
 *
 * GF=3 toward winner's top-scorers tally is handled by the standings
 * recompute, not this module — the score 3-0 already counts.
 */

export type MatchResult = {
  id: string;
  match_id: string;
  home_score: number;
  away_score: number;
  result_type: string;
  is_walkover: boolean;
  walkover_initiated_by: "admin" | "ref" | null;
  walkover_pending: boolean;
  walkover_confirmed_at: string | null;
  winner_player_id: string | null;
};

type MatchRow = {
  id: string;
  home_player_id: string;
  away_player_id: string;
  status?: string | null;
};

/**
 * Plan 51: best-effort fire walkover.confirmed on the standings channel.
 * Resolves seasonId via match → match_day → season. Failures swallowed.
 *
 * Bug 17 (2026-05-01) — also fires `score.changed` + `match.ended` on
 * the same standings channel so live data-feed overlays subscribed to
 * those events (h2h-2/3/5, leaderboard, match-scores-day, top-scorers)
 * repaint mid-stream the moment a walkover lands. Without these fan-
 * outs the overlays only repainted when the SQL trigger eventually
 * fired `standings.changed` — which lagged the visual feedback the
 * producer expected on hitting "Confirm walkover".
 */
async function emitWalkoverConfirmed(
  sb: SupabaseClient,
  matchId: string,
  winnerId: string,
  initiatedBy: "admin" | "ref",
): Promise<void> {
  try {
    const { data, error } = await sb
      .from("matches")
      .select(
        "id, home_player_id, away_player_id, match_day_id, match_days:match_day_id ( season_id )",
      )
      .eq("id", matchId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !data) return;
    const row = data as {
      home_player_id: string;
      away_player_id: string;
      match_days:
        | { season_id: string }
        | { season_id: string }[]
        | null;
    };
    // Supabase returns embedded relations as an array even for single-row FKs.
    const md = Array.isArray(row.match_days)
      ? row.match_days[0] ?? null
      : row.match_days;
    const seasonId = md?.season_id;
    if (!seasonId) return;
    const at = new Date().toISOString();

    // Read the post-walkover scores so we publish exactly what the
    // standings recompute will see. The walkover insert/update lands
    // before this helper is called, so the row is durable.
    const { data: resRow } = await sb
      .from("match_results")
      .select("home_score, away_score")
      .eq("match_id", matchId)
      .is("deleted_at", null)
      .maybeSingle();
    const homeScore = (resRow as { home_score?: number } | null)?.home_score ?? 0;
    const awayScore = (resRow as { away_score?: number } | null)?.away_score ?? 0;

    await publishWalkoverConfirmed(sb, {
      seasonId,
      matchId,
      winnerPlayerId: winnerId,
      initiatedBy,
      at,
    });
    // Bug 17 — fan-out for live overlay repaint.
    try {
      await publishScoreChanged(sb, {
        seasonId,
        matchId,
        homePlayerId: row.home_player_id,
        awayPlayerId: row.away_player_id,
        homeScore,
        awayScore,
        at,
      });
    } catch (err) {
      console.error("emitWalkoverConfirmed score.changed failed", err);
    }
    try {
      await publishMatchEnded(sb, {
        seasonId,
        matchId,
        homePlayerId: row.home_player_id,
        awayPlayerId: row.away_player_id,
        homeScore,
        awayScore,
        resultType: "forfeit",
        at,
      });
    } catch (err) {
      console.error("emitWalkoverConfirmed match.ended failed", err);
    }
  } catch (err) {
    console.error("emitWalkoverConfirmed failed", err);
  }
}

/**
 * Bug 17 (2026-05-01) — best-effort fire `score.changed` for any
 * match_results write that falls outside the walkover-confirmed flow
 * (markRefPendingWalkover, undoWalkover). Same channel + payload shape
 * as `emitPlan51SideEffects` in matches/results.ts so all overlays that
 * subscribe to `public:standings:<seasonId>` repaint identically.
 */
async function emitWalkoverScoreChange(
  sb: SupabaseClient,
  matchId: string,
  homeScore: number,
  awayScore: number,
): Promise<void> {
  try {
    const { data, error } = await sb
      .from("matches")
      .select(
        "id, home_player_id, away_player_id, match_day_id, match_days:match_day_id ( season_id )",
      )
      .eq("id", matchId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error || !data) return;
    const row = data as {
      home_player_id: string;
      away_player_id: string;
      match_days:
        | { season_id: string }
        | { season_id: string }[]
        | null;
    };
    const md = Array.isArray(row.match_days)
      ? row.match_days[0] ?? null
      : row.match_days;
    const seasonId = md?.season_id;
    if (!seasonId) return;
    await publishScoreChanged(sb, {
      seasonId,
      matchId,
      homePlayerId: row.home_player_id,
      awayPlayerId: row.away_player_id,
      homeScore,
      awayScore,
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("emitWalkoverScoreChange failed", err);
  }
}

async function loadMatch(
  sb: SupabaseClient,
  matchId: string,
): Promise<MatchRow> {
  const { data, error } = await sb
    .from("matches")
    .select("id, home_player_id, away_player_id, status")
    .eq("id", matchId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`loadMatch failed: ${error.message}`);
  if (!data) throw new Error(`match ${matchId} not found`);
  return data as MatchRow;
}

async function findExistingResult(
  sb: SupabaseClient,
  matchId: string,
): Promise<{ id: string } | null> {
  const { data, error } = await sb
    .from("match_results")
    .select("id")
    .eq("match_id", matchId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    throw new Error(`findExistingResult failed: ${error.message}`);
  }
  return (data as { id: string } | null) ?? null;
}

function scoresForWinner(match: MatchRow, winnerId: string): {
  home: number;
  away: number;
} {
  if (winnerId === match.home_player_id) return { home: 3, away: 0 };
  if (winnerId === match.away_player_id) return { home: 0, away: 3 };
  throw new Error(
    `winnerId ${winnerId} is not a participant of match ${match.id}`,
  );
}

/**
 * Admin-initiated walkover. Writes a finalised 3-0 row. Throws if a non-
 * walkover result already exists.
 */
export async function triggerAdminWalkover(
  matchId: string,
  winnerId: string,
  sb: SupabaseClient,
  actorUserId?: string,
): Promise<MatchResult> {
  const match = await loadMatch(sb, matchId);
  const existing = await findExistingResult(sb, matchId);
  if (existing) {
    throw new Error(
      `match ${matchId} already has a result; undo first before retriggering walkover`,
    );
  }
  const { home, away } = scoresForWinner(match, winnerId);

  const nowIso = new Date().toISOString();
  // Recompute_standings filters on confirmed_at IS NOT NULL — admin walkovers
  // ARE the authority, stamp both confirmed_at + confirmed_by alongside the
  // walkover-specific timestamp so the standings rebuild picks the row up.
  const payload = {
    match_id: matchId,
    home_score: home,
    away_score: away,
    result_type: "forfeit" as const,
    is_walkover: true,
    walkover_initiated_by: "admin" as const,
    walkover_pending: false,
    walkover_confirmed_at: nowIso,
    winner_player_id: winnerId,
    ...(actorUserId
      ? {
          entered_by: actorUserId,
          confirmed_by: actorUserId,
          confirmed_at: nowIso,
        }
      : {}),
  };

  const { data, error } = await sb
    .from("match_results")
    .insert(payload)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(
      `triggerAdminWalkover insert failed: ${error?.message ?? "no row"}`,
    );
  }

  // Update match status best-effort.
  await sb
    .from("matches")
    .update({ status: "forfeited" })
    .eq("id", matchId);

  // Plan 51: announce walkover.confirmed to the standings channel.
  await emitWalkoverConfirmed(sb, matchId, winnerId, "admin");

  return data as MatchResult;
}

/**
 * Referee-initiated provisional walkover. Score is 3-0 to the OPPONENT of
 * the absent player. walkover_pending=true until an admin confirms.
 */
export async function markRefPendingWalkover(
  matchId: string,
  absentPlayerId: string,
  sb: SupabaseClient,
  actorUserId?: string,
): Promise<MatchResult> {
  const match = await loadMatch(sb, matchId);
  if (
    absentPlayerId !== match.home_player_id &&
    absentPlayerId !== match.away_player_id
  ) {
    throw new Error(
      `absentPlayerId ${absentPlayerId} is not a participant of match ${matchId}`,
    );
  }
  const existing = await findExistingResult(sb, matchId);
  if (existing) {
    throw new Error(
      `match ${matchId} already has a result; cannot mark ref-pending walkover`,
    );
  }

  // Winner = opponent of the absent player.
  const winnerId =
    absentPlayerId === match.home_player_id
      ? match.away_player_id
      : match.home_player_id;
  const { home, away } = scoresForWinner(match, winnerId);

  const payload = {
    match_id: matchId,
    home_score: home,
    away_score: away,
    result_type: "forfeit" as const,
    is_walkover: true,
    walkover_initiated_by: "ref" as const,
    walkover_pending: true,
    walkover_confirmed_at: null,
    winner_player_id: winnerId,
    ...(actorUserId ? { entered_by: actorUserId } : {}),
  };

  const { data, error } = await sb
    .from("match_results")
    .insert(payload)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(
      `markRefPendingWalkover insert failed: ${error?.message ?? "no row"}`,
    );
  }
  // Bug 17 — fire score.changed even on the provisional ref-pending row
  // so live overlays show the 3-0 immediately rather than waiting for
  // admin confirm. The DB trigger already publishes standings.changed
  // when this row mutates, but score.changed is the application-layer
  // event most overlays subscribe to.
  await emitWalkoverScoreChange(sb, matchId, home, away);
  return data as MatchResult;
}

/**
 * Admin confirms a previously marked ref-pending walkover. No score change —
 * the referee already committed the score. Just flip `walkover_pending=false`
 * + stamp `walkover_confirmed_at`.
 */
export async function confirmRefPendingWalkover(
  matchId: string,
  sb: SupabaseClient,
  actorUserId?: string,
): Promise<MatchResult> {
  const { data: existing, error: lookupErr } = await sb
    .from("match_results")
    .select("*")
    .eq("match_id", matchId)
    .is("deleted_at", null)
    .maybeSingle();
  if (lookupErr) {
    throw new Error(`confirm lookup failed: ${lookupErr.message}`);
  }
  if (!existing) {
    throw new Error(`no match_result found for match ${matchId}`);
  }
  const row = existing as MatchResult;
  if (!row.is_walkover) {
    throw new Error(
      `match_result for ${matchId} is not a walkover; nothing to confirm`,
    );
  }
  if (row.walkover_initiated_by !== "ref") {
    throw new Error(
      `match_result for ${matchId} was not initiated by ref; cannot confirm`,
    );
  }
  if (!row.walkover_pending) {
    // already confirmed — idempotent return
    return row;
  }

  const nowIso = new Date().toISOString();
  // Promote the row from draft → confirmed so recompute_standings picks it up.
  const { data, error } = await sb
    .from("match_results")
    .update({
      walkover_pending: false,
      walkover_confirmed_at: nowIso,
      ...(actorUserId
        ? { confirmed_by: actorUserId, confirmed_at: nowIso }
        : {}),
    })
    .eq("id", row.id)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(
      `confirmRefPendingWalkover update failed: ${error?.message ?? "no row"}`,
    );
  }

  // Promote the match status best-effort once confirmed.
  await sb
    .from("matches")
    .update({ status: "forfeited" })
    .eq("id", matchId);

  // Plan 51: announce walkover.confirmed to the standings channel.
  const confirmedRow = data as MatchResult;
  if (confirmedRow.winner_player_id) {
    await emitWalkoverConfirmed(
      sb,
      matchId,
      confirmedRow.winner_player_id,
      "ref",
    );
  }

  return confirmedRow;
}

/**
 * Undo a walkover. Soft-deletes the match_results row + clears the match
 * status back to scheduled. Standings recompute fires from the trigger.
 */
export async function undoWalkover(
  matchId: string,
  sb: SupabaseClient,
): Promise<MatchResult> {
  const { data: existing, error: lookupErr } = await sb
    .from("match_results")
    .select("*")
    .eq("match_id", matchId)
    .is("deleted_at", null)
    .maybeSingle();
  if (lookupErr) {
    throw new Error(`undo lookup failed: ${lookupErr.message}`);
  }
  if (!existing) {
    throw new Error(`no match_result found for match ${matchId}`);
  }
  const row = existing as MatchResult;
  if (!row.is_walkover) {
    throw new Error(
      `match_result for ${matchId} is not a walkover; refusing to undo via this module`,
    );
  }

  const { data, error } = await sb
    .from("match_results")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", row.id)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(
      `undoWalkover update failed: ${error?.message ?? "no row"}`,
    );
  }

  // Reset match status back to scheduled.
  await sb
    .from("matches")
    .update({ status: "scheduled" })
    .eq("id", matchId);

  // Bug 17 — fire score.changed with 0-0 so live overlays clear the
  // walkover scoreline immediately. This mirrors the unvoid flow's
  // expectation that a removed result reverts the displayed score to
  // an unplayed state.
  await emitWalkoverScoreChange(sb, matchId, 0, 0);

  return data as MatchResult;
}
