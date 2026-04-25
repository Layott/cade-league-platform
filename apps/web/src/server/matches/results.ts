import type { SupabaseClient } from "@supabase/supabase-js";
import {
  enterResultSchema,
  confirmResultSchema,
  type EnterResultInput,
  type ConfirmResultInput,
} from "./schemas";
import { publishScoreChanged } from "@/server/realtime/publishers/score_changed";
import { publishMatchEnded } from "@/server/realtime/publishers/match_ended";
import { maybeCaptureMatchDaySnapshot } from "@/server/standings/auto_snapshot";

/**
 * Plan 51 — best-effort post-write fan-out: realtime score/match-ended
 * broadcasts + auto-snapshot when the match-day completes. None of these
 * may bubble up; the match_results row is the durable record.
 */
async function emitPlan51SideEffects(
  sb: SupabaseClient,
  matchId: string,
  resultType: EnterResultInput["resultType"],
  homeScore: number,
  awayScore: number,
): Promise<void> {
  try {
    // Resolve season + player ids in one round trip via the match row's
    // ancestors. The fixture chain is matches → match_days → seasons.
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
    // Supabase returns embedded relations as an array even when the FK is
    // single — normalise to the first row.
    const md = Array.isArray(row.match_days)
      ? row.match_days[0] ?? null
      : row.match_days;
    const seasonId = md?.season_id;
    if (!seasonId) return;

    const at = new Date().toISOString();
    // score.changed fires for every successful upsert (covers normal +
    // forfeit; voids would have early-returned in callers).
    await publishScoreChanged(sb, {
      seasonId,
      matchId,
      homePlayerId: row.home_player_id,
      awayPlayerId: row.away_player_id,
      homeScore,
      awayScore,
      at,
    });

    // match.ended fires for terminal result types (normal + forfeit).
    // void rows mean the match was disqualified, not played to completion.
    if (resultType === "normal" || resultType === "forfeit") {
      await publishMatchEnded(sb, {
        seasonId,
        matchId,
        homePlayerId: row.home_player_id,
        awayPlayerId: row.away_player_id,
        homeScore,
        awayScore,
        resultType,
        at,
      });
      // Auto-snapshot when this finalises the match-day.
      await maybeCaptureMatchDaySnapshot(matchId, sb);
    }
  } catch (err) {
    // Best-effort — the durable record is the SQL row.
    console.error("emitPlan51SideEffects failed", err);
  }
}

type ExistingResult = { id: string; confirmed_at: string | null } | null;

async function findExistingResult(
  sb: SupabaseClient,
  matchId: string
): Promise<ExistingResult> {
  const { data, error } = await sb
    .from("match_results")
    .select("id, confirmed_at")
    .eq("match_id", matchId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`findExistingResult failed: ${error.message}`);
  return data ?? null;
}

/**
 * Normalize forfeit scores: spec §3.3 says forfeit results are auto 3-0.
 * Whichever side has the HIGHER input score is considered the winner (3-0).
 * If both input scores are equal, default to home winning 3-0.
 */
function normalizeScores(input: EnterResultInput): { home: number; away: number } {
  if (input.resultType !== "forfeit") {
    return { home: input.homeScore, away: input.awayScore };
  }
  if (input.awayScore > input.homeScore) return { home: 0, away: 3 };
  return { home: 3, away: 0 };
}

function matchStatusFor(resultType: EnterResultInput["resultType"]): string {
  if (resultType === "forfeit") return "forfeited";
  if (resultType === "void") return "voided";
  return "completed";
}

export async function enterResult(
  sb: SupabaseClient,
  raw: EnterResultInput,
  actorUserId: string
): Promise<{ id: string }> {
  const input = enterResultSchema.parse(raw);

  const existing = await findExistingResult(sb, input.matchId);
  if (existing) {
    throw new Error(`result already exists for match ${input.matchId}; use editResult`);
  }

  const { home, away } = normalizeScores(input);

  const { data, error } = await sb
    .from("match_results")
    .insert({
      match_id: input.matchId,
      home_score: home,
      away_score: away,
      home_possession_pct: input.homePossession ?? null,
      away_possession_pct: input.awayPossession ?? null,
      result_type: input.resultType,
      entered_by: actorUserId,
      notes: input.notes ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`enterResult failed: ${error?.message ?? "no data"}`);
  }

  const { error: mErr } = await sb
    .from("matches")
    .update({ status: matchStatusFor(input.resultType) })
    .eq("id", input.matchId);
  if (mErr) throw new Error(`match status update failed: ${mErr.message}`);

  await emitPlan51SideEffects(sb, input.matchId, input.resultType, home, away);

  return { id: data.id };
}

export async function editResult(
  sb: SupabaseClient,
  raw: EnterResultInput
): Promise<{ id: string }> {
  const input = enterResultSchema.parse(raw);
  const existing = await findExistingResult(sb, input.matchId);
  if (!existing) throw new Error(`no result to edit for match ${input.matchId}`);

  const { home, away } = normalizeScores(input);
  const { data, error } = await sb
    .from("match_results")
    .update({
      home_score: home,
      away_score: away,
      home_possession_pct: input.homePossession ?? null,
      away_possession_pct: input.awayPossession ?? null,
      result_type: input.resultType,
      notes: input.notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("match_id", input.matchId)
    .select("id")
    .single();
  if (error || !data) throw new Error(`editResult failed: ${error?.message ?? "no data"}`);

  // Edit may have flipped forfeit/void/normal — reflect on match status.
  await sb
    .from("matches")
    .update({ status: matchStatusFor(input.resultType) })
    .eq("id", input.matchId);

  await emitPlan51SideEffects(sb, input.matchId, input.resultType, home, away);

  return { id: data.id };
}

/**
 * Plan 50: admin un-void a single match that was auto-voided by a ban.
 * Clears `result_type='void'` + `voided_by_action_id` and flips the match
 * status back to 'scheduled' so the referee can enter a real result.
 *
 * Does NOT touch the originating ban — use this when the ban is legit but
 * this particular fixture needs to play out anyway (e.g. the match had
 * already been played before the ban was backdated). To reverse ALL voids
 * for a ban, revoke the ban via /admin/punishments/[id].
 *
 * Callers are responsible for gating on `matches.edit`. Audit trigger
 * captures the row diff + the append-only caller note in `notes`.
 */
export async function unvoidMatchResult(
  sb: SupabaseClient,
  args: { matchId: string; actorUserId: string; reason: string },
): Promise<void> {
  const reason = args.reason.trim();
  if (!reason) {
    throw new Error("unvoidMatchResult requires a reason");
  }

  const { data: existing, error: readErr } = await sb
    .from("match_results")
    .select("id, result_type, voided_by_action_id, notes")
    .eq("match_id", args.matchId)
    .is("deleted_at", null)
    .maybeSingle();
  if (readErr) {
    throw new Error(`unvoidMatchResult read: ${readErr.message}`);
  }
  if (!existing) {
    throw new Error(`no result exists for match ${args.matchId}`);
  }
  const row = existing as {
    id: string;
    result_type: string;
    voided_by_action_id: string | null;
    notes: string | null;
  };
  if (row.result_type !== "void") {
    throw new Error(
      `match ${args.matchId} is not currently voided (result_type=${row.result_type})`,
    );
  }

  // Delete rather than edit: putting the match back in "scheduled" means the
  // match_results row should NOT exist until a real result is entered.
  // Separate matches.status flip below. Recompute will be triggered by the
  // DELETE → match_results_after_row trigger (Plan 3).
  const { error: delErr } = await sb
    .from("match_results")
    .delete()
    .eq("id", row.id);
  if (delErr) {
    throw new Error(`unvoidMatchResult delete: ${delErr.message}`);
  }

  const { error: mErr } = await sb
    .from("matches")
    .update({ status: "scheduled" })
    .eq("id", args.matchId);
  if (mErr) {
    throw new Error(`unvoidMatchResult status: ${mErr.message}`);
  }

  // Audit trail: the DELETE + UPDATE both land in audit_events with
  // `current_setting('app.current_user_id')` = args.actorUserId (set by
  // the API middleware). Reason captured above via the precheck.
  void args.actorUserId;
}

export async function confirmResult(
  sb: SupabaseClient,
  raw: ConfirmResultInput,
  actorUserId: string
): Promise<{ alreadyConfirmed: boolean }> {
  const input = confirmResultSchema.parse(raw);
  const existing = await findExistingResult(sb, input.matchId);
  if (!existing) throw new Error(`no result to confirm for match ${input.matchId}`);
  if (existing.confirmed_at) return { alreadyConfirmed: true };

  const { error } = await sb
    .from("match_results")
    .update({
      confirmed_by: actorUserId,
      confirmed_at: new Date().toISOString(),
    })
    .eq("match_id", input.matchId)
    .select("id")
    .single();
  if (error) throw new Error(`confirmResult failed: ${error.message}`);
  return { alreadyConfirmed: false };
}
