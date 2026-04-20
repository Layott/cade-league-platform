import type { SupabaseClient } from "@supabase/supabase-js";

export type AttendanceStatus = "present" | "late" | "absent";

export type LadderEntry = { sanction_type: "point_deduction"; magnitude: number };

/**
 * Phase 1A flat late-arrival ladder (spec §7):
 *   late   → 1 point deduction
 *   absent → 3 point deduction
 * Rule 5.4's scaled ladder is deferred to Phase 1B.
 */
export function flatLadder(status: AttendanceStatus): LadderEntry | null {
  if (status === "late") return { sanction_type: "point_deduction", magnitude: 1 };
  if (status === "absent") return { sanction_type: "point_deduction", magnitude: 3 };
  return null;
}

export type OpenAutoCaseInput = {
  playerId: string;
  status: AttendanceStatus;
  matchDayId: string;
  actorUserId: string;
  effectiveDate: string; // ISO date (YYYY-MM-DD)
};

export type OpenAutoCaseResult = { caseId: string; actionId: string } | null;

export async function openAutoCase(
  sb: SupabaseClient,
  input: OpenAutoCaseInput
): Promise<OpenAutoCaseResult> {
  const ladder = flatLadder(input.status);
  if (!ladder) return null;

  const { data: c, error: cErr } = await sb
    .from("disciplinary_cases")
    .insert({
      player_id: input.playerId,
      incident_type: "late_arrival",
      reported_by: input.actorUserId,
      status: "open",
      notes: `auto: attendance=${input.status} on match_day ${input.matchDayId}`,
    })
    .select("id")
    .single();
  if (cErr || !c) throw new Error(`failed to open case: ${cErr?.message ?? "no data"}`);

  const { data: a, error: aErr } = await sb
    .from("disciplinary_actions")
    .insert({
      case_id: c.id,
      sanction_type: ladder.sanction_type,
      magnitude: ladder.magnitude,
      effective_from: input.effectiveDate,
      imposed_by: input.actorUserId,
      public_visible: true,
    })
    .select("id")
    .single();
  if (aErr || !a) throw new Error(`failed to open action: ${aErr?.message ?? "no data"}`);

  return { caseId: c.id, actionId: a.id };
}

export type RevokeAutoActionInput = { actionId: string; reason: string };

export async function revokeAutoAction(
  sb: SupabaseClient,
  input: RevokeAutoActionInput
): Promise<void> {
  const { error } = await sb
    .from("disciplinary_actions")
    .update({
      revoked_at: new Date().toISOString(),
      revoke_reason: input.reason,
    })
    .eq("id", input.actionId);
  if (error) throw new Error(`failed to revoke action: ${error.message}`);
}
