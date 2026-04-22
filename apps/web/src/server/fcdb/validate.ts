import type { SupabaseClient } from "@supabase/supabase-js";
import { findPlayer } from "./lookup";
import type { FCPlayer, FCPlayerCandidate } from "./types";

/**
 * Plan 21 — `validateSubmittedSquadAgainstFCDB` is what Plan 23's ref-review
 * UI calls per submission. It runs `findPlayer` over each item and tags it
 * `resolved`, `fuzzy`, or `unknown` so the ref can confirm/correct in bulk.
 *
 * Status rules:
 *   - `resolved` → exactly 1 exact-slug hit, name length ≥ 4, AND (no rating
 *     filter active OR exact rating match).
 *   - `fuzzy`    → multiple exact-slug hits OR exact-slug hit at off-rating
 *                  OR no exact hits but ≥1 trigram hit.
 *   - `unknown`  → no hits anywhere.
 *
 * Trigram path is signalled by `candidate.sim` being defined.
 */

export type SubmittedItem = {
  slotIndex: number;
  name: string;
  rating?: number;
  position?: string;
  club?: string;
  itemType?: string;
};

export type FCDBValidationStatus = "resolved" | "fuzzy" | "unknown";

export type FCDBValidationResult = {
  slotIndex: number;
  status: FCDBValidationStatus;
  candidate?: FCPlayer;
  alternatives?: FCPlayer[];
};

const MIN_RESOLVE_NAME_LEN = 4;

function classify(
  candidates: FCPlayerCandidate[],
  item: SubmittedItem,
): FCDBValidationStatus {
  if (candidates.length === 0) return "unknown";

  const top = candidates[0];

  // Trigram fallback never auto-resolves; the ref must confirm.
  if (typeof top.sim === "number") return "fuzzy";

  // Multiple slug hits → ambiguous; ref picks.
  if (candidates.length > 1) return "fuzzy";

  // Single hit, but name too short to trust (e.g. "Bo", "X").
  if (item.name.trim().length < MIN_RESOLVE_NAME_LEN) return "fuzzy";

  // Single hit + rating provided + matches exactly → resolved.
  if (typeof item.rating === "number" && top.rating !== item.rating) {
    return "fuzzy";
  }

  return "resolved";
}

export async function validateSubmittedSquadAgainstFCDB(
  items: readonly SubmittedItem[],
  sb: SupabaseClient,
): Promise<FCDBValidationResult[]> {
  const results: FCDBValidationResult[] = [];

  for (const item of items) {
    const candidates = await findPlayer(sb, {
      name: item.name,
      rating: item.rating,
      position: item.position,
      club: item.club,
      itemType: item.itemType,
    });
    const status = classify(candidates, item);
    results.push({
      slotIndex: item.slotIndex,
      status,
      candidate: candidates[0],
      alternatives: candidates.slice(1),
    });
  }

  return results;
}
