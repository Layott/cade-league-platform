import type { SupabaseClient } from "@supabase/supabase-js";
import {
  reviewInputSchema,
  rejectInputSchema,
  type ReviewInput,
  type RejectInput,
  type ParsedStatsBlock,
} from "./schemas";

/**
 * Plan 14 — review.applyReview is the ONLY path that writes into
 * player_match_stats from the OCR pipeline. It enforces:
 *
 *   - screenshot must be in a reviewable state (parsed | pending)
 *   - score fields must match any confirmed match_results row
 *   - both sides upsert into player_match_stats (ON CONFLICT DO UPDATE)
 *   - screenshot flips to parse_status='confirmed' with audit metadata
 *
 * Recompute is NEVER called here. Standings rest on match_results; OCR data
 * is enrichment only.
 */

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export interface ApplyReviewResult {
  screenshotId: string;
  writtenRowCount: number;
}

function buildCustomMetrics(
  block: ParsedStatsBlock,
): Record<string, number | null> {
  return {
    possessionPct: block.possessionPct,
    shots: block.shots,
    shotsOnTarget: block.shotsOnTarget,
    passes: block.passes,
    passAccuracyPct: block.passAccuracyPct,
    tackles: block.tackles,
    interceptions: block.interceptions,
    fouls: block.fouls,
    ballRecoveries: block.ballRecoveries,
  };
}

export async function applyReview(
  sb: SupabaseClient,
  actorUserId: string,
  raw: ReviewInput,
): Promise<ApplyReviewResult> {
  const input = reviewInputSchema.parse(raw);

  // 1. Load the screenshot. Must be in a reviewable state.
  const { data: screenshot, error: loadErr } = await sb
    .from("match_stat_screenshots")
    .select("id, match_id, parse_status, parsed_by_engine")
    .eq("id", input.screenshotId)
    .is("deleted_at", null)
    .maybeSingle();
  if (loadErr || !screenshot) {
    throw new ValidationError(
      `screenshot not found: ${input.screenshotId}`,
    );
  }
  const REVIEWABLE = ["parsed", "pending", "failed"] as const;
  if (!REVIEWABLE.includes(screenshot.parse_status as typeof REVIEWABLE[number])) {
    throw new ConflictError(
      `screenshot ${input.screenshotId} already in terminal state: ${screenshot.parse_status}`,
    );
  }

  // 2. Score contradiction guard — fetch any confirmed match_results row
  //    and reject if the admin's corrected score disagrees.
  const { data: existingResult } = await sb
    .from("match_results")
    .select("home_score, away_score, confirmed_at")
    .eq("match_id", screenshot.match_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (
    existingResult &&
    existingResult.confirmed_at &&
    input.correctedJson.homeScore != null &&
    input.correctedJson.awayScore != null &&
    (existingResult.home_score !== input.correctedJson.homeScore ||
      existingResult.away_score !== input.correctedJson.awayScore)
  ) {
    throw new ConflictError(
      `score_mismatch: screenshot shows ${input.correctedJson.homeScore}-${input.correctedJson.awayScore} but confirmed match_result is ${existingResult.home_score}-${existingResult.away_score}`,
    );
  }

  // 3. Upsert player_match_stats for both sides. We compute clean_sheet =
  //    opponent goals === 0, falling back to stat-block goals when score is
  //    null.
  const home = input.correctedJson.homeStats;
  const away = input.correctedJson.awayStats;
  const homeGoals = home.goals ?? input.correctedJson.homeScore ?? 0;
  const awayGoals = away.goals ?? input.correctedJson.awayScore ?? 0;

  const rows = [
    {
      match_id: screenshot.match_id,
      player_id: input.homePlayerId,
      goals: homeGoals,
      assists: home.assists ?? 0,
      clean_sheet: awayGoals === 0,
      custom_metrics: buildCustomMetrics(home),
    },
    {
      match_id: screenshot.match_id,
      player_id: input.awayPlayerId,
      goals: awayGoals,
      assists: away.assists ?? 0,
      clean_sheet: homeGoals === 0,
      custom_metrics: buildCustomMetrics(away),
    },
  ];

  const { error: upsertErr } = await sb
    .from("player_match_stats")
    .upsert(rows, { onConflict: "match_id,player_id" });
  if (upsertErr) {
    throw new Error(
      `applyReview: player_match_stats upsert failed: ${upsertErr.message}`,
    );
  }

  // 4. Flip screenshot metadata.
  const now = new Date().toISOString();
  const nextEngine =
    screenshot.parsed_by_engine ?? "manual"; // pending→confirmed means admin hand-entered

  const { error: updErr } = await sb
    .from("match_stat_screenshots")
    .update({
      parse_status: "confirmed",
      confirmed_by: actorUserId,
      confirmed_at: now,
      parsed_by_engine: nextEngine,
      parsed_json: input.correctedJson,
      updated_at: now,
    })
    .eq("id", input.screenshotId);
  if (updErr) {
    throw new Error(
      `applyReview: screenshot update failed: ${updErr.message}`,
    );
  }

  return {
    screenshotId: input.screenshotId,
    writtenRowCount: 2,
  };
}

export async function rejectReview(
  sb: SupabaseClient,
  actorUserId: string,
  raw: RejectInput,
): Promise<void> {
  const input = rejectInputSchema.parse(raw);

  const { data: screenshot } = await sb
    .from("match_stat_screenshots")
    .select("id, parse_status")
    .eq("id", input.screenshotId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!screenshot) {
    throw new ValidationError(
      `screenshot not found: ${input.screenshotId}`,
    );
  }
  if (screenshot.parse_status === "confirmed") {
    throw new ConflictError(
      `screenshot ${input.screenshotId} already confirmed — cannot reject`,
    );
  }

  const now = new Date().toISOString();
  const { error } = await sb
    .from("match_stat_screenshots")
    .update({
      parse_status: "rejected",
      rejection_reason: input.reason,
      updated_at: now,
      // Store actor via notes suffix for audit traceability — the audit
      // trigger captures the app.current_user_id separately too.
      notes: `rejected by ${actorUserId}`,
    })
    .eq("id", input.screenshotId);
  if (error) {
    throw new Error(`rejectReview failed: ${error.message}`);
  }
}
