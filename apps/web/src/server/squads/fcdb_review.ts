import type { SupabaseClient } from "@supabase/supabase-js";
import { findPlayer } from "@/server/fcdb";
import type { FCPlayer, FCPlayerCandidate } from "@/server/fcdb";
import { requirePermAsync } from "@/lib/perms-db";
import type { Actor } from "@/perms";

/**
 * Plan 23 — ref-review enrichment for /admin/squads/[id].
 *
 * `reviewSquadAgainstFCDB` re-runs Plan 21's `findPlayer` over each live
 * `squad_player_items` row for a given submission, then maps the result to
 * a per-row review object the page server component renders inline next to
 * the existing items table.
 *
 * Plan 21's `validateSubmittedSquadAgainstFCDB` collapses ambiguous +
 * trigram into a single `fuzzy` status. This module **re-splits** them so
 * the UI can render distinct affordances:
 *   - `ambiguous` → ref picks one of N exact-slug candidates from a dropdown.
 *   - `fuzzy`     → trigram-only match; ref confirms or dismisses.
 *
 * **Plan 23 is purely informational.** The approve/reject decision still
 * lives in `server/squads/review.ts`. Setting `resolved_fc_player_id` does
 * not change the squad's validation_status.
 *
 * Empty-FCDB short-circuit: if `fc26_players` has 0 live rows we skip the
 * per-row `findPlayer` calls entirely and return `unknown` for every
 * item with a `reason` pointing to the runbook. This keeps the page fast
 * + functional in fresh clones (CSV not yet imported).
 */

const EMPTY_FCDB_REASON =
  "FCDB not yet populated — drop Kaggle CSV at KNOWLEDGE/extracted/fc26_players_kaggle.csv and run npm run fcdb:import";

const MIN_RESOLVE_NAME_LEN = 4;

export type SquadItemReviewStatus =
  | "resolved"
  | "fuzzy"
  | "ambiguous"
  | "unknown";

export type SquadItemReview = {
  itemId: string;
  slotIndex: number;
  status: SquadItemReviewStatus;
  candidate?: FCPlayer;
  alternatives: FCPlayer[];
  reason?: string;
  similarity?: number;
};

export type SquadFcdbReviewSummary = {
  total: number;
  resolved: number;
  fuzzy: number;
  ambiguous: number;
  unknown: number;
  fcdbEmpty: boolean;
};

type ItemRow = {
  id: string;
  submission_id: string;
  name: string;
  rating: number;
  position: string;
  value: number;
  item_type: string;
  nationality_flag: string | null;
  slot_index: number;
};

/**
 * Detect FCDB emptiness with a single `head + count` request. Cheap (no
 * row payload). Empty → caller short-circuits the per-row lookups.
 */
async function probeFcdbEmpty(sb: SupabaseClient): Promise<boolean> {
  const { count, error } = await sb
    .from("fc26_players")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null);
  if (error) {
    // Treat probe failure as "empty" rather than blowing up the page —
    // refs can still review manually. Surface the reason for forensics.
    return true;
  }
  return (count ?? 0) === 0;
}

/**
 * Re-split Plan 21's `fuzzy` umbrella into `ambiguous` (multi exact-slug
 * hit) vs `fuzzy` (trigram-only) so the UI renders the right affordance.
 */
function classify(
  candidates: FCPlayerCandidate[],
  item: { name: string; rating: number },
): {
  status: SquadItemReviewStatus;
  similarity?: number;
} {
  if (candidates.length === 0) return { status: "unknown" };

  const top = candidates[0];

  // Trigram path: top candidate carries `sim`. Plan 21 only sets `sim`
  // when the lookup fell back to trigram, so this discriminates cleanly.
  if (typeof top.sim === "number") {
    return { status: "fuzzy", similarity: top.sim };
  }

  // Multiple exact-slug hits → ambiguous (ref picks).
  if (candidates.length > 1) {
    return { status: "ambiguous" };
  }

  // Single exact-slug hit but name too short to trust → fuzzy.
  if (item.name.trim().length < MIN_RESOLVE_NAME_LEN) {
    return { status: "fuzzy" };
  }

  // Single hit + rating provided + mismatch → demote to fuzzy.
  if (typeof item.rating === "number" && top.rating !== item.rating) {
    return { status: "fuzzy" };
  }

  return { status: "resolved" };
}

function emptySummary(total: number, fcdbEmpty: boolean): SquadFcdbReviewSummary {
  return {
    total,
    resolved: 0,
    fuzzy: 0,
    ambiguous: 0,
    unknown: 0,
    fcdbEmpty,
  };
}

export async function reviewSquadAgainstFCDB(
  sb: SupabaseClient,
  submissionId: string,
): Promise<{ items: SquadItemReview[]; summary: SquadFcdbReviewSummary }> {
  // 1. Load live items for the submission.
  const { data: itemsData, error: itemsErr } = await sb
    .from("squad_player_items")
    .select(
      "id, submission_id, name, rating, position, value, item_type, nationality_flag, slot_index",
    )
    .eq("submission_id", submissionId)
    .is("deleted_at", null)
    .order("slot_index", { ascending: true });
  if (itemsErr) {
    throw new Error(`reviewSquadAgainstFCDB items: ${itemsErr.message}`);
  }
  const items = (itemsData ?? []) as ItemRow[];

  // No items → no work, no FCDB probe (saves a round-trip).
  if (items.length === 0) {
    return { items: [], summary: emptySummary(0, false) };
  }

  // 2. Probe FCDB. Empty → return all items as unknown with the runbook
  //    reason. This is the fresh-clone / CSV-not-loaded path.
  const fcdbEmpty = await probeFcdbEmpty(sb);
  if (fcdbEmpty) {
    const reviews = items.map<SquadItemReview>((it) => ({
      itemId: it.id,
      slotIndex: it.slot_index,
      status: "unknown",
      alternatives: [],
      reason: EMPTY_FCDB_REASON,
    }));
    return {
      items: reviews,
      summary: {
        total: items.length,
        resolved: 0,
        fuzzy: 0,
        ambiguous: 0,
        unknown: items.length,
        fcdbEmpty: true,
      },
    };
  }

  // 3. Per-row lookup. Sequential rather than Promise.all because the
  //    Supabase client serializes through one HTTP/1.1 keepalive
  //    connection — parallelising buys little but makes errors harder
  //    to attribute. 23 items × ~5ms each = budget OK.
  const reviews: SquadItemReview[] = [];
  const summary = emptySummary(items.length, false);

  for (const it of items) {
    const candidates = await findPlayer(sb, {
      name: it.name,
      rating: it.rating,
      position: it.position,
      // club intentionally omitted — squad_player_items doesn't carry
      // club, only name/rating/position/value/item_type. Adding club to
      // the items schema is a Plan 24+ enhancement.
    });
    const { status, similarity } = classify(candidates, {
      name: it.name,
      rating: it.rating,
    });

    const candidate = candidates[0];
    const alternatives = candidates.slice(1);

    reviews.push({
      itemId: it.id,
      slotIndex: it.slot_index,
      status,
      candidate: status === "unknown" ? undefined : candidate,
      alternatives,
      similarity,
    });

    if (status === "resolved") summary.resolved += 1;
    else if (status === "fuzzy") summary.fuzzy += 1;
    else if (status === "ambiguous") summary.ambiguous += 1;
    else summary.unknown += 1;
  }

  return { items: reviews, summary };
}

/**
 * Plan 23 — server-side handler for the ref's "lock in" action on an
 * ambiguous candidate. Validates: (1) actor has squads.validate, (2) item
 * is live, (3) FCDB candidate is live. Audit fires automatically via the
 * trigger on squad_player_items (Plan 0 + Plan 10).
 *
 * Note: we do NOT require the submission to be `pending`. A ref can
 * retroactively annotate an approved squad with a corrected FCDB pick
 * without re-opening the validation decision — the squad's
 * approve/reject status is independent of FCDB resolution.
 */
export async function acceptFcdbCandidate(
  sb: SupabaseClient,
  actor: Actor,
  itemId: string,
  fcPlayerId: string,
): Promise<void> {
  await requirePermAsync(sb, actor, "squads.validate");

  if (!itemId || !fcPlayerId) {
    throw new Error("itemId and fcPlayerId required");
  }

  const { data: item } = await sb
    .from("squad_player_items")
    .select("id, submission_id")
    .eq("id", itemId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!item) {
    throw new Error(`squad item not found or soft-deleted: ${itemId}`);
  }

  const { data: fc } = await sb
    .from("fc26_players")
    .select("id")
    .eq("id", fcPlayerId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!fc) {
    throw new Error(`fcdb candidate not found or soft-deleted: ${fcPlayerId}`);
  }

  const { error } = await sb
    .from("squad_player_items")
    .update({ resolved_fc_player_id: fcPlayerId })
    .eq("id", itemId);
  if (error) throw new Error(`acceptFcdbCandidate update: ${error.message}`);
}
