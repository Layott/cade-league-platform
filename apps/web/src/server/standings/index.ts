import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Thin wrapper around the SQL function public.recompute_standings(uuid).
 *
 * In Phase 1A this is rarely called from app code — the AFTER trigger on
 * match_results already fires it. Use cases for the wrapper:
 *   - Reconciliation script (verify standings by forcing a rebuild).
 *   - Future background job (Phase 2+).
 *   - Plan 4: manual trigger after disciplinary_action mutations (until the
 *     Plan 4 trigger lands).
 */
export async function recomputeStandings(
  sb: SupabaseClient,
  seasonId: string
): Promise<void> {
  const { error } = await sb.rpc("recompute_standings", { p_season_id: seasonId });
  if (error) throw new Error(`recomputeStandings failed: ${error.message}`);
}
