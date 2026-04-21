import type { SupabaseClient } from "@supabase/supabase-js";

export type AdjustInput = {
  playerId: string;
  category: string;
  delta: -1 | 1;
  reason: string;
};

export class AdjustPrecedentError extends Error {}

/**
 * Nudge a precedent counter up or down by exactly 1 with a mandatory reason.
 * The audit trigger captures the before/after row — no hand-coded audit call.
 *
 * Rules:
 *   - delta ∈ { -1, +1 } (enforced by type at compile time, re-checked at runtime)
 *   - reason must be at least 6 non-whitespace chars
 *   - delta=-1 on a missing row is refused (cannot go negative)
 *   - delta=+1 on a missing row inserts offense_count=1
 */
export async function adjustPrecedent(
  sb: SupabaseClient,
  _actorUserId: string,
  input: AdjustInput,
): Promise<void> {
  if (input.delta !== 1 && input.delta !== -1) {
    throw new AdjustPrecedentError("delta must be exactly +1 or -1");
  }
  const trimmed = input.reason?.trim() ?? "";
  if (trimmed.length < 6) {
    throw new AdjustPrecedentError("reason must be at least 6 characters");
  }

  const { data: existing, error: readErr } = await sb
    .from("disciplinary_precedents")
    .select("offense_count")
    .eq("player_id", input.playerId)
    .eq("category", input.category)
    .is("deleted_at", null)
    .maybeSingle();
  if (readErr) throw new Error(`adjustPrecedent read: ${readErr.message}`);

  if (!existing) {
    if (input.delta === -1) {
      throw new AdjustPrecedentError(
        "cannot decrement: no precedent row exists for this (player, category)",
      );
    }
    const { error: insErr } = await sb
      .from("disciplinary_precedents")
      .insert({
        player_id: input.playerId,
        category: input.category,
        offense_count: 1,
        last_offense_at: new Date().toISOString(),
      });
    if (insErr) throw new Error(`adjustPrecedent insert: ${insErr.message}`);
    return;
  }

  const next = Math.max(0, (existing.offense_count as number) + input.delta);
  const { error: updErr } = await sb
    .from("disciplinary_precedents")
    .update({
      offense_count: next,
      updated_at: new Date().toISOString(),
    })
    .eq("player_id", input.playerId)
    .eq("category", input.category);
  if (updErr) throw new Error(`adjustPrecedent update: ${updErr.message}`);
}
