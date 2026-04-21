import type { SupabaseClient } from "@supabase/supabase-js";
import {
  markShootAttendanceSchema,
  type MarkShootAttendanceInput,
} from "./schemas";
import { issue as issuePunishment } from "@/server/punishments";

export class PreseasonAttendanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreseasonAttendanceError";
  }
}

export type PreseasonAttendanceRow = {
  id: string;
  shoot_id: string;
  player_id: string;
  attended_bool: boolean;
  warning_issued_bool: boolean;
  warning_action_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

/**
 * Mark attendance for one player on one shoot. Upserts the row (one per
 * shoot × player). If the player was absent AND no warning has been issued
 * yet, auto-issues a warning disciplinary case (incident_type='preseason_miss')
 * via the punishments module, then flips `warning_issued_bool`.
 *
 * Idempotent: re-saving an absent row whose `warning_issued_bool` is already
 * true is a no-op for the punishment path.
 */
export async function markAttendance(
  sb: SupabaseClient,
  raw: MarkShootAttendanceInput,
): Promise<PreseasonAttendanceRow> {
  const input = markShootAttendanceSchema.parse(raw);

  // 1. Upsert attendance row (idempotent on shoot + player).
  const { data: existing, error: exErr } = await sb
    .from("preseason_shoot_attendance")
    .select("*")
    .eq("shoot_id", input.shootId)
    .eq("player_id", input.playerId)
    .is("deleted_at", null)
    .maybeSingle();
  if (exErr) {
    throw new PreseasonAttendanceError(
      `markAttendance read: ${exErr.message}`,
    );
  }

  let row: PreseasonAttendanceRow;
  if (existing) {
    const { data, error } = await sb
      .from("preseason_shoot_attendance")
      .update({
        attended_bool: input.attended,
        notes: input.notes ?? (existing as PreseasonAttendanceRow).notes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", (existing as { id: string }).id)
      .select("*")
      .single();
    if (error || !data) {
      throw new PreseasonAttendanceError(
        `markAttendance update: ${error?.message ?? "unknown"}`,
      );
    }
    row = data as PreseasonAttendanceRow;
  } else {
    const { data, error } = await sb
      .from("preseason_shoot_attendance")
      .insert({
        shoot_id: input.shootId,
        player_id: input.playerId,
        attended_bool: input.attended,
        notes: input.notes ?? null,
      })
      .select("*")
      .single();
    if (error || !data) {
      throw new PreseasonAttendanceError(
        `markAttendance insert: ${error?.message ?? "unknown"}`,
      );
    }
    row = data as PreseasonAttendanceRow;
  }

  // 2. If absent AND no warning yet, issue one.
  if (!row.attended_bool && !row.warning_issued_bool) {
    const issued = await issuePunishment(sb, input.actorUserId, {
      playerId: input.playerId,
      incidentType: "preseason_miss",
      sanctionType: "warning",
      magnitude: 0,
      publicVisible: true,
      notes: `Missed pre-season shoot ${input.shootId} (Rule 2.5)`,
    });

    const { data: updated, error: updErr } = await sb
      .from("preseason_shoot_attendance")
      .update({
        warning_issued_bool: true,
        warning_action_id: issued.actionId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .select("*")
      .single();
    if (updErr || !updated) {
      throw new PreseasonAttendanceError(
        `markAttendance warning link: ${updErr?.message ?? "unknown"}`,
      );
    }
    row = updated as PreseasonAttendanceRow;
  }

  return row;
}

export async function listAttendanceForShoot(
  sb: SupabaseClient,
  shootId: string,
): Promise<PreseasonAttendanceRow[]> {
  const { data, error } = await sb
    .from("preseason_shoot_attendance")
    .select("*")
    .eq("shoot_id", shootId)
    .is("deleted_at", null);
  if (error) {
    throw new PreseasonAttendanceError(
      `listAttendanceForShoot: ${error.message}`,
    );
  }
  return (data ?? []) as PreseasonAttendanceRow[];
}
