import type { SupabaseClient } from "@supabase/supabase-js";

export type SuspensionWindow = { from: string; until: string };

/**
 * Resolve an `effective_from`/`effective_until` window covering the next
 * `matchDays` scheduled match days on or after `startFromDate`.
 *
 * Fallback: if no match_days rows are found (off-season or empty fixture
 * list), return `startFromDate` → `startFromDate + 6 days`. This keeps a
 * suspension safely non-empty so the void-propagation trigger has a window
 * to iterate — it just won't find any matches to void.
 *
 * For `matchDays = SEASON_REMAINING` (Number.MAX_SAFE_INTEGER) the caller
 * likely wants the whole remaining season; we cap the query at 1000 rows
 * and fall back to the season_end if provided.
 */
export async function resolveSuspensionWindow(
  sb: SupabaseClient,
  seasonId: string,
  startFromDate: string,
  matchDays: number,
): Promise<SuspensionWindow> {
  const cap = matchDays > 1000 ? 1000 : matchDays;
  const limit = Math.max(1, cap);

  const { data, error } = await sb
    .from("match_days")
    .select("match_date")
    .eq("season_id", seasonId)
    .is("deleted_at", null)
    .gte("match_date", startFromDate)
    .order("match_date", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`resolveSuspensionWindow: ${error.message}`);

  const rows = (data ?? []) as Array<{ match_date: string }>;

  if (rows.length === 0) {
    const start = new Date(`${startFromDate}T00:00:00+01:00`);
    const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
    return { from: startFromDate, until: end.toISOString().slice(0, 10) };
  }

  return {
    from: rows[0].match_date,
    until: rows[rows.length - 1].match_date,
  };
}
