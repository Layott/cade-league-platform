import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { itemSchema, type SquadItemInput } from "./schemas";
import { ConflictError, ValidationError } from "./errors";

/**
 * Plan 10 — replace all squad_player_items rows for a submission in one atomic
 * sweep. Only permitted while `validation_status='pending'`.
 * Old rows are soft-deleted (deleted_at=now()) so audit still sees them.
 */
export async function replaceItemsForSubmission(
  sb: SupabaseClient,
  submissionId: string,
  items: SquadItemInput[],
): Promise<void> {
  const parsed = z.array(itemSchema).min(1).max(23).safeParse(items);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "invalid items");
  }

  // Check submission status.
  const { data: sub, error: subErr } = await sb
    .from("squad_submissions")
    .select("id, validation_status")
    .eq("id", submissionId)
    .is("deleted_at", null)
    .maybeSingle();
  if (subErr || !sub) throw new Error(`submission not found: ${submissionId}`);
  if (sub.validation_status !== "pending") {
    throw new ConflictError(
      `cannot edit items: submission is ${sub.validation_status}`,
    );
  }

  // Soft-delete existing live items.
  const { error: delErr } = await sb
    .from("squad_player_items")
    .update({ deleted_at: new Date().toISOString() })
    .eq("submission_id", submissionId)
    .is("deleted_at", null);
  if (delErr) throw new Error(`failed to soft-delete old items: ${delErr.message}`);

  const rows = parsed.data.map((it) => ({
    submission_id: submissionId,
    name: it.name,
    rating: it.rating,
    position: it.position,
    value: it.value,
    item_type: it.itemType,
    nationality_flag: it.nationalityFlag ?? null,
    slot_index: it.slotIndex,
  }));
  const { error: insErr } = await sb.from("squad_player_items").insert(rows);
  if (insErr) throw new Error(`failed to insert items: ${insErr.message}`);
}
