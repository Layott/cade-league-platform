import type { SupabaseClient } from "@supabase/supabase-js";
import type { CardSearchResult } from "@/server/fcdb/search";
import type { Actor } from "@/perms";

/**
 * Squad picker autosave drafts (2026-04-30).
 *
 * A draft persists the in-flight picker state (formation + slot map + subs
 * bench + screenshot upload reference) so a player can close the browser
 * mid-pick, return, and find their selections intact.
 *
 * Lifecycle:
 *   - Picker hydrates initial state from `getDraft` on page load.
 *   - Every change (formation / slot / sub / screenshot) debounces a
 *     `saveDraft` call from the client.
 *   - `clearDraft` runs after a successful `squad_submissions` insert so the
 *     partial unique index `(player_id, week_start_date) WHERE deleted_at IS
 *     NULL` doesn't block next week's draft.
 *
 * The JSON columns (`slots_json`, `subs_json`) carry full `CardSearchResult`
 * snapshots so the picker can render the FUT card visuals on rehydrate
 * without re-querying `fc26_players`. The snapshot is an opaque payload —
 * the server only needs `fcdbPlayerId` (slot.card.id) at submit time, so we
 * deliberately skip Zod validation here. Missing / changed fields fall back
 * to empty defaults in the picker.
 */

export type DraftSlotRow = {
  slotIndex: number;
  /** Snapshot of the picked card. The picker re-renders straight from this
   *  on hydrate; the submit path resolves `card.id` (= `fcdbPlayerId`) back
   *  through the canonical FCDB lookup. */
  card: CardSearchResult;
};

export type DraftRow = {
  formation: string;
  slots: DraftSlotRow[];
  subs: Array<CardSearchResult | null>;
  screenshotPath: string | null;
  updatedAt: string;
};

export type SaveDraftInput = {
  playerId: string;
  weekStartDate: string;
  matchDayId?: string | null;
  formation: string;
  slots: DraftSlotRow[];
  subs: Array<CardSearchResult | null>;
  screenshotPath: string | null;
};

type Row = {
  id: string;
  player_id: string;
  week_start_date: string;
  match_day_id: string | null;
  formation: string;
  slots_json: unknown;
  subs_json: unknown;
  screenshot_path: string | null;
  set_by: string;
  created_at: string;
  updated_at: string;
};

const SELECT_COLS =
  "id, player_id, week_start_date, match_day_id, formation, slots_json, subs_json, screenshot_path, set_by, created_at, updated_at";

function rowToDraft(r: Row): DraftRow {
  const slotsRaw = Array.isArray(r.slots_json) ? r.slots_json : [];
  const subsRaw = Array.isArray(r.subs_json) ? r.subs_json : [];
  return {
    formation: r.formation,
    slots: slotsRaw as DraftSlotRow[],
    subs: subsRaw as Array<CardSearchResult | null>,
    screenshotPath: r.screenshot_path,
    updatedAt: r.updated_at,
  };
}

export async function getDraft(
  sb: SupabaseClient,
  playerId: string,
  weekStartDate: string,
  matchDayId?: string | null,
): Promise<DraftRow | null> {
  let q = sb
    .from("squad_drafts")
    .select(SELECT_COLS)
    .eq("player_id", playerId)
    .eq("week_start_date", weekStartDate)
    .is("deleted_at", null);
  // Per-match-day mode: scope to the explicit match_day_id when provided.
  // Without it we return the week-anchored draft regardless of match_day_id
  // (covers the legacy weekly mode).
  if (matchDayId) q = q.eq("match_day_id", matchDayId);
  const { data, error } = await q.maybeSingle();
  if (error) {
    throw new Error(`getDraft: ${error.message}`);
  }
  return data ? rowToDraft(data as Row) : null;
}

/**
 * SELECT-then-INSERT-or-UPDATE pattern. Required because Supabase JS's
 * `.upsert({onConflict})` throws PG 42P10 against the partial unique index
 * `squad_drafts_one_active_per_week`. Same pattern as upsertTextElement
 * (b2dd661d) + setStripLayoutAction (b7b3deff).
 */
export async function saveDraft(
  sb: SupabaseClient,
  actor: Actor,
  input: SaveDraftInput,
): Promise<DraftRow> {
  if (!actor.userId) throw new Error("saveDraft: no actor.userId");

  const nowIso = new Date().toISOString();
  const row = {
    player_id: input.playerId,
    week_start_date: input.weekStartDate,
    match_day_id: input.matchDayId ?? null,
    formation: input.formation,
    slots_json: input.slots ?? [],
    subs_json: input.subs ?? [],
    screenshot_path: input.screenshotPath,
    set_by: actor.userId,
    updated_at: nowIso,
    deleted_at: null,
  };

  const { data: existing } = await sb
    .from("squad_drafts")
    .select("id")
    .eq("player_id", input.playerId)
    .eq("week_start_date", input.weekStartDate)
    .is("deleted_at", null)
    .maybeSingle();

  if (existing) {
    const { data, error } = await sb
      .from("squad_drafts")
      .update(row)
      .eq("id", (existing as { id: string }).id)
      .select(SELECT_COLS)
      .single();
    if (error) throw new Error(`saveDraft (update): ${error.message}`);
    return rowToDraft(data as Row);
  } else {
    const { data, error } = await sb
      .from("squad_drafts")
      .insert(row)
      .select(SELECT_COLS)
      .single();
    if (error) throw new Error(`saveDraft (insert): ${error.message}`);
    return rowToDraft(data as Row);
  }
}

/**
 * Soft-delete the active draft for (playerId, weekStartDate). Idempotent:
 * no-op when no live draft exists. Called from `submitPickerSquad` after
 * the squad_submissions row + items land successfully.
 */
export async function clearDraft(
  sb: SupabaseClient,
  playerId: string,
  weekStartDate: string,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await sb
    .from("squad_drafts")
    .update({ deleted_at: nowIso, updated_at: nowIso })
    .eq("player_id", playerId)
    .eq("week_start_date", weekStartDate)
    .is("deleted_at", null);
  if (error) {
    throw new Error(`clearDraft: ${error.message}`);
  }
}
