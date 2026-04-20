import type { SupabaseClient } from "@supabase/supabase-js";
import { openAutoCase, revokeAutoAction, type AttendanceStatus } from "./penalty";

export class ValidationError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ValidationError";
  }
}

export type EditMarkInput = {
  markId: string;
  newStatus: AttendanceStatus;
  reason: string;
  actorUserId: string;
};

export async function editMark(sb: SupabaseClient, input: EditMarkInput): Promise<void> {
  if (!input.reason || !input.reason.trim()) {
    throw new ValidationError("override_reason required");
  }

  // 1. Load current mark.
  const { data: mark, error: mErr } = await sb
    .from("attendance_marks")
    .select("id, match_day_id, player_id, status, auto_case_id, auto_action_id")
    .eq("id", input.markId)
    .is("deleted_at", null)
    .single();
  if (mErr || !mark) throw new Error(`mark not found: ${input.markId}`);

  const prev = mark.status as AttendanceStatus;
  const next = input.newStatus;

  const wasPenal = prev === "late" || prev === "absent";
  const becomesPenal = next === "late" || next === "absent";
  const statusChanged = prev !== next;

  let newCaseId: string | null = mark.auto_case_id ?? null;
  let newActionId: string | null = mark.auto_action_id ?? null;

  // 2. Revoke old auto-action if moving away from late/absent OR switching
  //    between late ↔ absent (magnitude differs).
  if (statusChanged && wasPenal && mark.auto_action_id) {
    await revokeAutoAction(sb, {
      actionId: mark.auto_action_id,
      reason: `attendance edit: ${input.reason.trim()}`,
    });
    newCaseId = null;
    newActionId = null;
  }

  // 3. Open fresh auto-case if becoming late/absent and we don't already have one
  //    matching this status. (Simplest rule: after revoke, always open fresh.)
  if (statusChanged && becomesPenal) {
    const { data: md } = await sb
      .from("match_days")
      .select("match_date")
      .eq("id", mark.match_day_id)
      .single();
    const effectiveDate =
      (md as { match_date: string } | null)?.match_date ??
      new Date().toISOString().slice(0, 10);

    const auto = await openAutoCase(sb, {
      playerId: mark.player_id,
      status: next,
      matchDayId: mark.match_day_id,
      actorUserId: input.actorUserId,
      effectiveDate,
    });
    if (auto) {
      newCaseId = auto.caseId;
      newActionId = auto.actionId;
    }
  }

  // 4. Persist the edit.
  const { error: uErr } = await sb
    .from("attendance_marks")
    .update({
      status: next,
      override_reason: input.reason.trim(),
      marked_at: new Date().toISOString(),
      marked_by: input.actorUserId,
      auto_case_id: newCaseId,
      auto_action_id: newActionId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.markId);
  if (uErr) throw new Error(`failed to update mark: ${uErr.message}`);
}
