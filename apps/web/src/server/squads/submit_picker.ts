import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createSubmission } from "./submit";
import { ConflictError, ValidationError } from "./errors";

/**
 * Plan 30 — picker-flow submission helper.
 *
 * Bridges the Futbin-style picker's `{ fcdbPlayerId, positionInLineup }[]`
 * shape into Plan 10's `createSubmission()` by hydrating each picked card
 * from `fc26_players` and passing the denormalised item shape (name,
 * rating, position, value, item_type, nationality_flag) that the existing
 * `squad_player_items` table expects.
 *
 * After the submission lands we UPDATE every newly-inserted
 * `squad_player_items` row with its `resolved_fc_player_id` so the ref
 * review UI (Plan 23) sees the picker-resolved FCDB link immediately
 * without needing a second ambiguity resolution pass.
 */

export const pickerSlotSchema = z.object({
  fcdbPlayerId: z.string().uuid(),
  positionInLineup: z.string().min(1).max(8),
  slotIndex: z.number().int().min(0).max(22),
});

export type PickerSlotInput = z.infer<typeof pickerSlotSchema>;

export const submitPickerInputSchema = z.object({
  seasonId: z.string().uuid(),
  playerId: z.string().uuid(),
  weekStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  futbinScreenshotPath: z.string().min(1),
  slots: z.array(pickerSlotSchema).min(1).max(23),
});

export type SubmitPickerInput = z.infer<typeof submitPickerInputSchema>;

type FcRow = {
  id: string;
  name: string;
  rating: number;
  position: string;
  value_coins_estimate: number | null;
  item_type: string;
  nation_iso: string | null;
  nation: string | null;
};

const ALLOWED_ITEM_TYPES = [
  "gold",
  "silver",
  "bronze",
  "hero",
  "icon",
  "legend",
  "special",
  "other",
] as const;

/**
 * Coerce the Kaggle-flavoured `item_type` values (normal, totw, icon, hero,
 * evolution, special, other) onto the Plan 10 `squad_player_items.item_type`
 * check-constraint set (gold/silver/bronze/…).
 *
 * The mapping is lossy but deterministic. Refs can refine post-submission
 * via /admin/squads/[id].
 */
function mapItemType(src: string | null | undefined, rating: number): string {
  const s = (src ?? "").toLowerCase();
  if (s === "icon") return "icon";
  if (s === "hero") return "hero";
  if (s === "totw" || s === "special" || s === "evolution") return "special";
  if (ALLOWED_ITEM_TYPES.includes(s as (typeof ALLOWED_ITEM_TYPES)[number])) {
    return s;
  }
  // Default: derive gold/silver/bronze from rating.
  if (rating >= 75) return "gold";
  if (rating >= 65) return "silver";
  return "bronze";
}

export async function submitPickerSquad(
  sb: SupabaseClient,
  input: SubmitPickerInput,
  opts: { now?: Date } = {},
): Promise<{ id: string }> {
  const parsed = submitPickerInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "invalid input");
  }
  const v = parsed.data;

  // Enforce slotIndex uniqueness at the helper layer (matches the DB's
  // unique(submission_id, slot_index) index in a friendlier error).
  const seenSlot = new Set<number>();
  for (const s of v.slots) {
    if (seenSlot.has(s.slotIndex)) {
      throw new ValidationError(`duplicate slotIndex ${s.slotIndex}`);
    }
    seenSlot.add(s.slotIndex);
  }
  // A card can only appear once in the squad (starting XI + subs + reserves).
  // Without this guard a player could stack multiple copies of the same
  // Mbappé and artificially pump chemistry or visual clout.
  const seenCard = new Set<string>();
  for (const s of v.slots) {
    if (seenCard.has(s.fcdbPlayerId)) {
      throw new ValidationError(
        `duplicate card: fcdbPlayerId ${s.fcdbPlayerId} appears in multiple slots`,
      );
    }
    seenCard.add(s.fcdbPlayerId);
  }

  // 1. Hydrate the picked cards from `fc26_players` in one query.
  const cardIds = v.slots.map((s) => s.fcdbPlayerId);
  const { data: cards, error: cardsErr } = await sb
    .from("fc26_players")
    .select("id, name, rating, position, value_coins_estimate, item_type, nation_iso, nation")
    .in("id", cardIds)
    .eq("source_dataset", "futbin.com")
    .is("deleted_at", null);
  if (cardsErr) {
    throw new Error(`failed to hydrate picked cards: ${cardsErr.message}`);
  }
  const byId = new Map((cards ?? []).map((c: FcRow) => [c.id, c]));

  // Every slot must resolve — otherwise the picker sent a deleted/unknown id.
  for (const slot of v.slots) {
    if (!byId.has(slot.fcdbPlayerId)) {
      throw new ConflictError(
        `fcdb card not found or soft-deleted: ${slot.fcdbPlayerId}`,
      );
    }
  }

  // 2. Build the Plan 10 item payload, one row per slot.
  const items = v.slots.map((slot) => {
    const card = byId.get(slot.fcdbPlayerId)!;
    return {
      name: card.name,
      rating: card.rating,
      // The lineup position wins over the card's canonical position so a
      // card played out-of-position (e.g. CAM used as CF) carries the
      // lineup slot, not the card's primary.
      position: slot.positionInLineup,
      value: card.value_coins_estimate ?? 0,
      itemType: mapItemType(card.item_type, card.rating) as
        | "gold"
        | "silver"
        | "bronze"
        | "hero"
        | "icon"
        | "legend"
        | "special"
        | "other",
      // Futbin's /26/players list often leaves nation_iso null — the CDN
      // nation icons don't carry the ISO code in an easily parseable spot.
      // Fall back to the full nation name ("Nigeria"), which server-side
      // validate.ts now accepts alongside the ISO form.
      nationalityFlag: card.nation_iso ?? card.nation,
      slotIndex: slot.slotIndex,
    };
  });

  // 3. Delegate to Plan 10's `createSubmission` — keeps the unique-week
  //    guard, weekStartDate enforcement, and schema validation in one place.
  const result = await createSubmission(
    sb,
    {
      seasonId: v.seasonId,
      playerId: v.playerId,
      weekStartDate: v.weekStartDate,
      futbinScreenshotPath: v.futbinScreenshotPath,
      items,
    },
    opts,
  );

  // 4. Annotate each inserted item with its FCDB id so Plan 23's review
  //    surface sees a fully-resolved squad immediately. Done in a single
  //    round-trip per slot — acceptable given slots ≤ 23.
  //    Best-effort: if the annotation fails we don't unwind the submission
  //    (it's still valid per Plan 10; the ref can still resolve via Plan 23).
  const { data: inserted } = await sb
    .from("squad_player_items")
    .select("id, slot_index")
    .eq("submission_id", result.id)
    .is("deleted_at", null);
  if (inserted && inserted.length > 0) {
    const bySlot = new Map(
      (inserted as Array<{ id: string; slot_index: number }>).map((r) => [
        r.slot_index,
        r.id,
      ]),
    );
    for (const slot of v.slots) {
      const itemId = bySlot.get(slot.slotIndex);
      if (!itemId) continue;
      await sb
        .from("squad_player_items")
        .update({ resolved_fc_player_id: slot.fcdbPlayerId })
        .eq("id", itemId);
    }
  }

  return result;
}
