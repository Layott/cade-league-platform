import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeLateSanction,
  computeAbsentSanction,
  getOffenseCount,
  resolveSuspensionWindow,
  SEASON_REMAINING,
  type LadderOutcome,
} from "@/server/precedents";

export type AttendanceStatus = "present" | "late" | "absent";

export type OpenAutoCaseInput = {
  playerId: string;
  status: AttendanceStatus;
  matchDayId: string;
  actorUserId: string;
  effectiveDate: string; // ISO date (YYYY-MM-DD)
};

export type OpenAutoCaseResult = {
  caseId: string;
  /** "Dominant" disciplinary_action — point_deduction if any, else gd_deduction, else ban, else null. */
  actionId: string | null;
  /** Rich breakdown for callers that want to know every action created. */
  actionIds: {
    pointDeduction: string | null;
    gdDeduction: string | null;
    ban: string | null;
  };
  outcome: LadderOutcome;
  priorCount: number;
} | null;

/**
 * Translate a late/absent attendance mark into a full Rule 5.4 ladder event:
 *
 *   1. Read precedent count (defaults to 0).
 *   2. Consult `computeLateSanction` / `computeAbsentSanction`.
 *   3. Always open a `disciplinary_cases` row — even for 1st-late "log only"
 *      the row carries status='auto'. `createCase==='none'` → status='auto';
 *      'warning' + 'disciplinary' → status='open'. This keeps every action
 *      linked to a case (disciplinary_actions.case_id NOT NULL).
 *   4. Insert disciplinary_actions for any non-zero magnitude. Bans
 *      resolve their window via the next-N match_days helper.
 *   5. Auto-forfeit is applied by the caller (attendance/mark.ts) using
 *      Plan 4's applyForfeitMatchResult — we return the outcome flag.
 *   6. Precedent counter is bumped by the Postgres trigger on
 *      attendance_marks INSERT (see migration 20260502000003). Do NOT
 *      upsert from TS — would double-count.
 */
export async function openAutoCase(
  sb: SupabaseClient,
  input: OpenAutoCaseInput,
): Promise<OpenAutoCaseResult> {
  if (input.status === "present") return null;

  const category = input.status === "late" ? "late_arrival" : "absent";
  const priorCount = await getOffenseCount(sb, input.playerId, category);
  const outcome =
    input.status === "late"
      ? computeLateSanction(priorCount)
      : computeAbsentSanction(priorCount);

  // 1. Always create a case row so disciplinary_actions.case_id stays NOT NULL.
  const caseStatus = outcome.createCase === "none" ? "auto" : "open";
  const offenseNumber = priorCount + 1;
  const noteParts = [
    `auto: attendance=${input.status} on match_day ${input.matchDayId}`,
    `offense #${offenseNumber}`,
    outcome.rulebookClause,
  ];
  const { data: c, error: cErr } = await sb
    .from("disciplinary_cases")
    .insert({
      player_id: input.playerId,
      incident_type: category,
      reported_by: input.actorUserId,
      status: caseStatus,
      notes: noteParts.join(" | "),
    })
    .select("id")
    .single();
  if (cErr || !c) throw new Error(`failed to open case: ${cErr?.message ?? "no data"}`);

  const actionIds = {
    pointDeduction: null as string | null,
    gdDeduction: null as string | null,
    ban: null as string | null,
  };

  // 2. Point deduction (sanction_type='point_deduction').
  if (outcome.pointDeduction > 0) {
    const { data: a, error: aErr } = await sb
      .from("disciplinary_actions")
      .insert({
        case_id: c.id,
        sanction_type: "point_deduction",
        magnitude: outcome.pointDeduction,
        effective_from: input.effectiveDate,
        imposed_by: input.actorUserId,
        public_visible: true,
        notes: outcome.rulebookClause,
      })
      .select("id")
      .single();
    if (aErr || !a) throw new Error(`point_deduction insert: ${aErr?.message}`);
    actionIds.pointDeduction = a.id as string;
  }

  // 3. GD deduction (sanction_type='gd_deduction'). Applied to NEXT match per
  //    rulebook phrasing — recompute_standings will subtract it regardless of
  //    which match it "attaches" to, so effective_from is the mark date.
  if (outcome.gdDeduction > 0) {
    const { data: a, error: aErr } = await sb
      .from("disciplinary_actions")
      .insert({
        case_id: c.id,
        sanction_type: "gd_deduction",
        magnitude: outcome.gdDeduction,
        effective_from: input.effectiveDate,
        imposed_by: input.actorUserId,
        public_visible: true,
        notes: outcome.rulebookClause,
      })
      .select("id")
      .single();
    if (aErr || !a) throw new Error(`gd_deduction insert: ${aErr?.message}`);
    actionIds.gdDeduction = a.id as string;
  }

  // 4. Ban (sanction_type='ban'). Resolve the suspension window against
  //    match_days; the ban_propagation trigger voids affected matches.
  if (outcome.suspensionMatchDays > 0) {
    // Look up season so we can resolve the window.
    const { data: md, error: mdErr } = await sb
      .from("match_days")
      .select("season_id, match_date")
      .eq("id", input.matchDayId)
      .single();
    if (mdErr || !md) throw new Error(`ban window: match_day ${input.matchDayId} not found`);

    const { from, until } = await resolveSuspensionWindow(
      sb,
      md.season_id as string,
      md.match_date as string,
      outcome.suspensionMatchDays === SEASON_REMAINING
        ? 1000
        : outcome.suspensionMatchDays,
    );

    const { data: ban, error: banErr } = await sb
      .from("disciplinary_actions")
      .insert({
        case_id: c.id,
        sanction_type: "ban",
        magnitude: 0,
        effective_from: from,
        effective_until: until,
        imposed_by: input.actorUserId,
        public_visible: true,
        notes: outcome.rulebookClause,
      })
      .select("id")
      .single();
    if (banErr || !ban) throw new Error(`ban insert: ${banErr?.message}`);
    actionIds.ban = ban.id as string;
  }

  // Pick a dominant action id for attendance_marks.auto_action_id (scalar FK).
  const dominant =
    actionIds.pointDeduction ?? actionIds.gdDeduction ?? actionIds.ban ?? null;

  return {
    caseId: c.id as string,
    actionId: dominant,
    actionIds,
    outcome,
    priorCount,
  };
}

export type RevokeAutoActionInput = { actionId: string; reason: string };

/**
 * Revoke an auto-generated disciplinary_action. Used by attendance/editMark
 * when the admin changes a prior late/absent to present (or another status).
 *
 * Note: if the action is sanction_type='ban' the DB trigger
 * `disciplinary_actions_ban_propagation` will un-propagate voids
 * automatically; no extra work here.
 */
export async function revokeAutoAction(
  sb: SupabaseClient,
  input: RevokeAutoActionInput,
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
