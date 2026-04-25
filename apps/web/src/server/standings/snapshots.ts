import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Plan 51 — standings snapshots per match-day.
 *
 * After every match-day finishes the system captures a frozen copy of the
 * current standings into `leaderboard_snapshots`. The table is append-only via
 * trigger (parent agent owns the migration), so this module is intentionally
 * IDEMPOTENT: a second `captureSnapshot()` call for the same match-day
 * returns the existing row instead of trying to overwrite + tripping the
 * append-only guard.
 *
 * Reads use the `standings` view shaped by `recompute_standings()`. We
 * project the full row payload into `snapshot_data` JSONB so the snapshot
 * survives schema changes to the live standings table — restoring a frozen
 * snapshot is as simple as JSON.parse + render.
 */

export type StandingsSnapshot = {
  id: number;
  capturedAt: string;
  snapshotData: unknown;
};

type StandingsRow = Record<string, unknown> & {
  season_id?: string;
  player_id?: string;
};

/**
 * Look up the season for a match-day, then dump every standings row for that
 * season into a single JSONB array stored on `leaderboard_snapshots`. Re-running
 * this for the same match-day returns the existing row — no overwrite.
 */
export async function captureSnapshot(
  matchDayId: string,
  supabase: SupabaseClient,
): Promise<StandingsSnapshot> {
  // 1. Bail out early if a snapshot already exists.
  const existing = await readSnapshot(matchDayId, supabase);
  if (existing) {
    // Need to also surface the id for callers that want to link to it.
    const { data: row, error: lookupErr } = await supabase
      .from("leaderboard_snapshots")
      .select("id, captured_at, snapshot_data")
      .eq("match_day_id", matchDayId)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lookupErr) {
      throw new Error(`captureSnapshot lookup failed: ${lookupErr.message}`);
    }
    if (row) {
      return {
        id: (row as { id: number }).id,
        capturedAt: (row as { captured_at: string }).captured_at,
        snapshotData: (row as { snapshot_data: unknown }).snapshot_data,
      };
    }
  }

  // 2. Resolve the season id for this match-day.
  const { data: matchDay, error: mdErr } = await supabase
    .from("match_days")
    .select("id, season_id")
    .eq("id", matchDayId)
    .is("deleted_at", null)
    .maybeSingle();
  if (mdErr) {
    throw new Error(`captureSnapshot match-day lookup failed: ${mdErr.message}`);
  }
  if (!matchDay) {
    throw new Error(`captureSnapshot: match-day ${matchDayId} not found`);
  }
  const seasonId = (matchDay as { season_id: string }).season_id;

  // 3. Read live standings rows for the season.
  const { data: rows, error: standingsErr } = await supabase
    .from("standings")
    .select("*")
    .eq("season_id", seasonId)
    .is("deleted_at", null);
  if (standingsErr) {
    throw new Error(
      `captureSnapshot standings read failed: ${standingsErr.message}`,
    );
  }
  const snapshotPayload = (rows ?? []) as StandingsRow[];

  // 4. Insert the snapshot row. season_id lives inside snapshot_data JSONB
  //    (the migration's leaderboard_snapshots table only has match_day_id FK).
  const { data: inserted, error: insertErr } = await supabase
    .from("leaderboard_snapshots")
    .insert({
      match_day_id: matchDayId,
      snapshot_data: { season_id: seasonId, rows: snapshotPayload },
    })
    .select("id, captured_at, snapshot_data")
    .single();
  if (insertErr || !inserted) {
    throw new Error(
      `captureSnapshot insert failed: ${insertErr?.message ?? "no row"}`,
    );
  }
  return {
    id: (inserted as { id: number }).id,
    capturedAt: (inserted as { captured_at: string }).captured_at,
    snapshotData: (inserted as { snapshot_data: unknown }).snapshot_data,
  };
}

/**
 * Read the most recent snapshot for a match-day. Returns null if none.
 */
export async function readSnapshot(
  matchDayId: string,
  supabase: SupabaseClient,
): Promise<{ snapshotData: unknown; capturedAt: string } | null> {
  const { data, error } = await supabase
    .from("leaderboard_snapshots")
    .select("captured_at, snapshot_data")
    .eq("match_day_id", matchDayId)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`readSnapshot failed: ${error.message}`);
  if (!data) return null;
  return {
    snapshotData: (data as { snapshot_data: unknown }).snapshot_data,
    capturedAt: (data as { captured_at: string }).captured_at,
  };
}
