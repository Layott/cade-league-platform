"use server";

import type { CardSearchResult } from "@/server/fcdb/search";
import { getServerSupabase } from "@/lib/supabase/server";
import { enforceAuthedWrite } from "@/lib/api-rate-limit";
import { saveDraft } from "@/server/squads";

/**
 * Squad picker autosave — server action.
 *
 * Called from the picker on every state change (debounced ~800ms in the
 * client). Authentication is the only gate: any logged-in player may
 * autosave their OWN draft. The `users.id` (resolved via Supabase auth →
 * public.users) is set both as `player_id` (the column points at users(id)
 * — historical naming) and `set_by` so audit trail attribution works.
 *
 * Failures are swallowed at the call site (the picker logs to console.warn
 * + keeps editing) — autosave must NEVER block UI interactions. The action
 * returns a structured `{ok}` envelope so the client can opt into a status
 * pip without needing try/catch.
 */

export type SaveSquadDraftActionInput = {
  weekStartDate: string;
  matchDayId?: string | null;
  formation: string;
  slots: Array<{
    slotIndex: number;
    fcdbPlayerId: string;
    positionInLineup: string;
    cardSnapshot: CardSearchResult;
  }>;
  subs: Array<CardSearchResult | null>;
  screenshotPath: string | null;
};

export type SaveSquadDraftActionResult =
  | { ok: true; updatedAt: string }
  | { ok: false; error: string };

export async function saveSquadDraftAction(
  input: SaveSquadDraftActionInput,
): Promise<SaveSquadDraftActionResult> {
  try {
    const sb = await getServerSupabase();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return { ok: false, error: "unauthenticated" };

    const { data: pub } = await sb
      .from("users")
      .select("id")
      .eq("supabase_auth_id", user.id)
      .single();
    if (!pub) return { ok: false, error: "no public user row" };

    const userId = (pub as { id: string }).id;

    // Per-write rate limiter (same gate as submitPickerAction).
    const limited = await enforceAuthedWrite(userId);
    if (limited) return { ok: false, error: "rate_limited" };

    if (!input.weekStartDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.weekStartDate)) {
      return { ok: false, error: "invalid weekStartDate" };
    }

    // Translate the wire shape (slotIndex + cardSnapshot) into the DraftRow
    // shape the server module persists. We deliberately drop fcdbPlayerId +
    // positionInLineup — they're already encoded in the cardSnapshot (id +
    // positionInLineup applies only at submit time).
    const slots = (input.slots ?? []).map((s) => ({
      slotIndex: s.slotIndex,
      card: s.cardSnapshot,
    }));

    const result = await saveDraft(
      sb,
      { userId, roles: ["player"] },
      {
        playerId: userId,
        weekStartDate: input.weekStartDate,
        matchDayId: input.matchDayId ?? null,
        formation: input.formation,
        slots,
        subs: input.subs ?? [],
        screenshotPath: input.screenshotPath,
      },
    );

    return { ok: true, updatedAt: result.updatedAt };
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? "save failed" };
  }
}
