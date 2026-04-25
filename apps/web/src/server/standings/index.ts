import type { SupabaseClient } from "@supabase/supabase-js";
import { publishStandingsChanged } from "./realtime";

/**
 * Thin wrapper around the SQL function public.recompute_standings(uuid).
 *
 * In Phase 1A this is rarely called from app code — the AFTER trigger on
 * match_results already fires it. Use cases for the wrapper:
 *   - Reconciliation script (verify standings by forcing a rebuild).
 *   - Future background job (Phase 2+).
 *   - Plan 4: manual trigger after disciplinary_action mutations (until the
 *     Plan 4 trigger lands).
 *
 * Plan 51: explicitly fire `standings.changed` on the public channel after
 * a successful recompute. The DB trigger version of `recompute_standings`
 * already fires from SQL (see migration 20260518000100), but app-layer
 * recomputes (admin "force recompute" buttons, reconciliation scripts) need
 * a parallel publish so subscribers refresh either way. The publish helper
 * uses the same channel + event name as the SQL trigger, so subscribers
 * remain channel-agnostic about which side fired.
 */
export async function recomputeStandings(
  sb: SupabaseClient,
  seasonId: string
): Promise<void> {
  const { error } = await sb.rpc("recompute_standings", { p_season_id: seasonId });
  if (error) throw new Error(`recomputeStandings failed: ${error.message}`);

  // Plan 51 — fire standings.changed broadcast (fire-and-forget).
  try {
    await publishStandingsChanged(sb, seasonId);
  } catch (err) {
    // The DB trigger already fired the SQL-side broadcast; this is a
    // best-effort secondary push and must not bubble up.
    console.error("publishStandingsChanged failed", err);
  }
}
