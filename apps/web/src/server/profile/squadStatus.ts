import type { SupabaseClient } from "@supabase/supabase-js";
import {
  weekStartThursday,
  thursdayDeadline,
  fridayWindowBounds,
  isWithinFridayWindow,
} from "@/lib/time";
import { getSquadWindowOverride } from "@/server/squads/window_override";

/**
 * Plan 41 — P41-F — squad-status helper for the /player dashboard card + banner.
 *
 * Given a `playerId` and a frozen `now`, returns the player's current
 * this-week squad state as a discriminated union the UI can pattern-match on.
 *
 * Kinds (per spec §3.4):
 *   - pre_deadline       — no submission yet, Thursday 10:00 WAT deadline upcoming.
 *   - submitted_pending  — submission exists, awaiting admin review.
 *   - submitted_approved — admin approved.
 *   - submitted_rejected — admin rejected (carries reason).
 *   - window_closed      — past Thursday deadline, no submission, Friday window not open.
 *   - friday_change_window — Friday 21:00-22:00 WAT window live for an approved submission.
 *   - reopened_by_admin  — admin reversed status back to pending (P41-G will drive this).
 *
 * P41-G has not shipped yet, so `reopened_by_admin` is detected opportunistically:
 * if `validation_status='pending'` AND an audit_events row exists marking the
 * submission as re-opened post-Thursday deadline, we return `reopened_by_admin`.
 * Until P41-G lands, the query is a best-effort lookup that falls back to
 * `submitted_pending` when no audit marker is present.
 */

export type SquadStatus =
  | { kind: "pre_deadline"; hoursUntil: number; deadline: Date }
  | { kind: "submitted_pending" }
  | { kind: "submitted_approved" }
  | { kind: "submitted_rejected"; reason: string | null }
  | { kind: "window_closed" }
  | { kind: "friday_change_window"; changesRemaining: number }
  | { kind: "reopened_by_admin"; reopenedAt: Date; reopenedBy: string | null };

type SubmissionMinimalRow = {
  id: string;
  validation_status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  week_start_date: string;
};

async function fetchCurrentSubmission(
  sb: SupabaseClient,
  playerId: string,
  weekStart: string,
): Promise<SubmissionMinimalRow | null> {
  // Migration 20260801000020 split the legacy weekly unique index into
  // per-(player, match_day_id) rows + a legacy (player, week) row, so a
  // single Thursday-anchor week can carry both Saturday and Sunday
  // submissions. `.maybeSingle()` errors on >1 row, which crashes every
  // `/player/*` page via the layout-level dashboard banner. Pick the
  // most-recent live submission so the banner reflects the player's
  // latest action across the weekend pair.
  const { data, error } = await sb
    .from("squad_submissions")
    .select("id, validation_status, rejection_reason, week_start_date")
    .eq("player_id", playerId)
    .eq("week_start_date", weekStart)
    .is("deleted_at", null)
    .order("submitted_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`fetchCurrentSubmission: ${error.message}`);
  const rows = (data as SubmissionMinimalRow[] | null) ?? [];
  return rows[0] ?? null;
}

async function countLiveChangeRequests(
  sb: SupabaseClient,
  submissionId: string,
): Promise<number> {
  const { count, error } = await sb
    .from("squad_change_requests")
    .select("id", { count: "exact", head: true })
    .eq("submission_id", submissionId)
    .is("deleted_at", null);
  if (error) throw new Error(`countLiveChangeRequests: ${error.message}`);
  return count ?? 0;
}

/**
 * Look for a post-deadline audit_events row that indicates an admin flipped
 * `validation_status` back to pending. P41-G will write such rows; for now
 * we rely on the generic audit trigger + a `metadata.reopened = true` marker.
 */
async function findReopenAuditEvent(
  sb: SupabaseClient,
  submissionId: string,
  thursdayDeadlineDate: Date,
): Promise<{ reopenedAt: Date; reopenedBy: string | null } | null> {
  const { data, error } = await sb
    .from("audit_events")
    .select("actor_user_id, created_at, after_json")
    .eq("entity_type", "squad_submissions")
    .eq("entity_id", submissionId)
    .eq("action", "update")
    .gte("created_at", thursdayDeadlineDate.toISOString())
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) {
    // Non-fatal — P41-G may not be live; treat as no reopen marker.
    return null;
  }
  type Row = {
    actor_user_id: string | null;
    created_at: string;
    after_json: Record<string, unknown> | null;
  };
  const rows = (data ?? []) as Row[];
  for (const r of rows) {
    const meta = r.after_json;
    if (meta && typeof meta === "object" && "reopened" in meta && meta.reopened === true) {
      return {
        reopenedAt: new Date(r.created_at),
        reopenedBy: r.actor_user_id,
      };
    }
  }
  return null;
}

export async function getCurrentSquadStatus(
  sb: SupabaseClient,
  playerId: string,
  now: Date,
): Promise<SquadStatus> {
  const weekStart = weekStartThursday(now);
  const deadline = thursdayDeadline(weekStart);
  const { closeAt: fridayClose } = fridayWindowBounds(weekStart);

  // Admin override takes precedence over the time-based window.
  const override = await getSquadWindowOverride(sb, weekStart);

  const submission = await fetchCurrentSubmission(sb, playerId, weekStart);

  // 1. Nothing submitted yet.
  if (!submission) {
    if (override?.state === "force_close") return { kind: "window_closed" };
    if (override?.state === "force_open") {
      return { kind: "pre_deadline", hoursUntil: 0, deadline };
    }
    if (now < deadline) {
      const hoursUntil = Math.max(
        0,
        Math.ceil((deadline.getTime() - now.getTime()) / 3_600_000),
      );
      return { kind: "pre_deadline", hoursUntil, deadline };
    }
    return { kind: "window_closed" };
  }

  // 2. Submission exists — branch on status.
  if (submission.validation_status === "rejected") {
    return { kind: "submitted_rejected", reason: submission.rejection_reason };
  }

  if (submission.validation_status === "pending") {
    // A pending row past the Thursday deadline is suspicious — check for an
    // admin reopen audit marker before defaulting to submitted_pending.
    if (now > deadline) {
      const reopen = await findReopenAuditEvent(sb, submission.id, deadline);
      if (reopen) {
        return {
          kind: "reopened_by_admin",
          reopenedAt: reopen.reopenedAt,
          reopenedBy: reopen.reopenedBy,
        };
      }
    }
    return { kind: "submitted_pending" };
  }

  // validation_status === 'approved'
  if (isWithinFridayWindow(now, weekStart)) {
    const used = await countLiveChangeRequests(sb, submission.id);
    return { kind: "friday_change_window", changesRemaining: Math.max(0, 1 - used) };
  }

  if (now >= fridayClose) {
    // Approved + past the whole weekly flow.
    return { kind: "submitted_approved" };
  }

  return { kind: "submitted_approved" };
}
