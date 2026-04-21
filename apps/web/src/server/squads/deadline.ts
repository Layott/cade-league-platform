import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Plan 10 — Thursday 10:00 WAT deadline helpers.
 *
 * Used by the hourly cron at /api/cron/squad-deadline-check:
 *   1. Find the set of players who missed the deadline this week.
 *   2. For each missed player, open a disciplinary_case + action per the
 *      1st/2nd/3rd-offense ladder.
 *
 * Idempotent: the auto-warning notes field carries a stable marker
 * `squad_late:{weekStart}` so re-runs within the same week are no-ops.
 */

export async function whoMissedDeadline(
  sb: SupabaseClient,
  seasonId: string,
  weekStart: string,
): Promise<string[]> {
  // All active participants.
  const { data: parts, error: pErr } = await sb
    .from("season_participants")
    .select("player_id")
    .eq("season_id", seasonId)
    .is("deleted_at", null);
  if (pErr) throw new Error(`whoMissed: participants query failed: ${pErr.message}`);
  const allPlayerIds = (parts ?? []).map((r: { player_id: string }) => r.player_id);
  if (allPlayerIds.length === 0) return [];

  // Players who already submitted this week.
  const { data: subs, error: sErr } = await sb
    .from("squad_submissions")
    .select("player_id")
    .eq("season_id", seasonId)
    .eq("week_start_date", weekStart)
    .is("deleted_at", null);
  if (sErr) throw new Error(`whoMissed: submissions query failed: ${sErr.message}`);
  const submitted = new Set(
    (subs ?? []).map((r: { player_id: string }) => r.player_id),
  );

  return allPlayerIds.filter((id) => !submitted.has(id));
}

export type LadderRank = 1 | 2 | 3;

export function laddersAnction(rank: LadderRank): {
  sanction_type: "warning" | "point_deduction";
  magnitude: number;
} {
  // Placeholder flat ladder — see plan §3.5. Plan 11 tightens against rulebook.
  if (rank === 1) return { sanction_type: "warning", magnitude: 0 };
  if (rank === 2) return { sanction_type: "warning", magnitude: 0 };
  return { sanction_type: "point_deduction", magnitude: 3 };
}

export async function countPriorSquadLateCases(
  sb: SupabaseClient,
  playerId: string,
): Promise<number> {
  const { count, error } = await sb
    .from("disciplinary_cases")
    .select("id", { head: true, count: "exact" })
    .eq("player_id", playerId)
    .eq("incident_type", "squad_late_submission")
    .is("deleted_at", null);
  if (error) throw new Error(`countPriorSquadLateCases: ${error.message}`);
  return count ?? 0;
}

/**
 * Idempotent auto-warning issuer. Skips when a case with
 * `notes LIKE 'squad_late:{weekStart}%'` already exists for this player.
 */
export async function issueAutoWarningForMissed(
  sb: SupabaseClient,
  input: {
    playerId: string;
    seasonId: string;
    weekStart: string;
    reporterUserId: string;
  },
): Promise<{ created: boolean; caseId?: string; actionId?: string }> {
  const marker = `squad_late:${input.weekStart}`;

  // Idempotency check.
  const { data: existing } = await sb
    .from("disciplinary_cases")
    .select("id")
    .eq("player_id", input.playerId)
    .eq("incident_type", "squad_late_submission")
    .ilike("notes", `${marker}%`)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing) return { created: false };

  const prior = await countPriorSquadLateCases(sb, input.playerId);
  const rank = (prior >= 2 ? 3 : ((prior + 1) as LadderRank)) as LadderRank;
  const sanction = laddersAnction(rank);

  const { data: c, error: cErr } = await sb
    .from("disciplinary_cases")
    .insert({
      player_id: input.playerId,
      incident_type: "squad_late_submission",
      reported_by: input.reporterUserId,
      status: "open",
      notes: `${marker} — missed Thursday 10:00 WAT deadline (auto)`,
    })
    .select("id")
    .single();
  if (cErr || !c) throw new Error(`failed to open case: ${cErr?.message}`);

  const { data: a, error: aErr } = await sb
    .from("disciplinary_actions")
    .insert({
      case_id: c.id,
      sanction_type: sanction.sanction_type,
      magnitude: sanction.magnitude,
      effective_from: input.weekStart,
      imposed_by: input.reporterUserId,
      public_visible: true,
      notes: `auto: squad-late-submission rank=${rank}`,
    })
    .select("id")
    .single();
  if (aErr || !a) throw new Error(`failed to open action: ${aErr?.message}`);

  return { created: true, caseId: c.id, actionId: a.id };
}
