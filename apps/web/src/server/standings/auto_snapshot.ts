import type { SupabaseClient } from "@supabase/supabase-js";
import { captureSnapshot } from "./snapshots";

/**
 * Plan 51 — auto-snapshot trigger.
 *
 * When the LAST match of a match-day is marked final, capture a leaderboard
 * snapshot automatically. The animated-leaderboard overlay reads snapshots
 * to compute "↑N / ↓N" position deltas between consecutive match-days.
 *
 * This is purely server-side. Callers wire it into the match_results upsert
 * path AFTER a `final` write lands. Failures are logged + swallowed — a
 * snapshot miss is recoverable (admin can re-trigger from `/admin/tournament`)
 * but a thrown exception would block the score-entry write.
 *
 * Idempotent: `captureSnapshot` already short-circuits when a snapshot for
 * the match-day exists, so re-running this on an already-snapshotted day
 * is safe.
 */

export type AutoSnapshotResult =
  | { captured: true; matchDayId: string; snapshotId: number }
  | { captured: false; reason: "not_final_match" | "missing_match" | "error" };

async function loadMatchDayForMatch(
  sb: SupabaseClient,
  matchId: string,
): Promise<{ matchDayId: string } | null> {
  const { data, error } = await sb
    .from("matches")
    .select("match_day_id")
    .eq("id", matchId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) return null;
  return { matchDayId: (data as { match_day_id: string }).match_day_id };
}

async function countTotalAndFinalized(
  sb: SupabaseClient,
  matchDayId: string,
): Promise<{ total: number; finalized: number }> {
  // Total non-deleted matches in the match-day.
  const { data: allRows, error: allErr } = await sb
    .from("matches")
    .select("id")
    .eq("match_day_id", matchDayId)
    .is("deleted_at", null);
  if (allErr) throw new Error(`countMatches failed: ${allErr.message}`);
  const total = (allRows ?? []).length;
  if (total === 0) return { total: 0, finalized: 0 };

  // Finalized = has a non-deleted match_results row with result_type in
  // ('normal','forfeit'). Voids do NOT count as finalized — a voided
  // match is "absent" from the standings rather than complete.
  const ids = (allRows as { id: string }[]).map((r) => r.id);
  const { data: resultRows, error: resErr } = await sb
    .from("match_results")
    .select("match_id, result_type")
    .in("match_id", ids)
    .in("result_type", ["normal", "forfeit"])
    .is("deleted_at", null);
  if (resErr) throw new Error(`countResults failed: ${resErr.message}`);
  return { total, finalized: (resultRows ?? []).length };
}

/**
 * Inspect the match-day the given match belongs to. If every match in that
 * day is now finalized (normal or forfeit, voids excluded), capture a
 * leaderboard snapshot for the match-day.
 *
 * Fire-and-forget at the call site: catch errors + log, do NOT propagate.
 */
export async function maybeCaptureMatchDaySnapshot(
  matchId: string,
  sb: SupabaseClient,
): Promise<AutoSnapshotResult> {
  try {
    const md = await loadMatchDayForMatch(sb, matchId);
    if (!md) {
      return { captured: false, reason: "missing_match" };
    }
    const { total, finalized } = await countTotalAndFinalized(sb, md.matchDayId);
    if (total === 0 || finalized < total) {
      return { captured: false, reason: "not_final_match" };
    }

    const snap = await captureSnapshot(md.matchDayId, sb);
    return {
      captured: true,
      matchDayId: md.matchDayId,
      snapshotId: snap.id,
    };
  } catch (err) {
    // Swallow — caller never blocks on a snapshot capture failure.
    console.error("maybeCaptureMatchDaySnapshot failed", err);
    return { captured: false, reason: "error" };
  }
}
