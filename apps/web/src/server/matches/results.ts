import type { SupabaseClient } from "@supabase/supabase-js";
import {
  enterResultSchema,
  confirmResultSchema,
  type EnterResultInput,
  type ConfirmResultInput,
} from "./schemas";

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
  return { id: data.id };
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
