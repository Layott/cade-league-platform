import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Flip overdue open appeals (submitted | under_review) past their deadline_at
 * to status='expired'. Idempotent — any re-run is a no-op.
 *
 * Returns the count of rows flipped. Call from a cron trigger or admin
 * "Sweep expired appeals" button.
 */
export async function markExpired(
  sb: SupabaseClient,
  now: Date = new Date(),
): Promise<{ expired: number }> {
  const { data, error } = await sb
    .from("appeals")
    .update({
      status: "expired",
      updated_at: now.toISOString(),
    })
    .in("status", ["submitted", "under_review"])
    .lt("deadline_at", now.toISOString())
    .is("deleted_at", null)
    .select("id");
  if (error) throw new Error(`markExpired: ${error.message}`);
  return { expired: (data ?? []).length };
}
