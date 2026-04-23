import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePermAsync } from "@/lib/perms-db";
import type { Actor } from "@/perms";

/**
 * Per-player admin override for the weekly squad submission window.
 *
 * Sits alongside `squad_window_overrides` (league-wide). This module
 * targets a single (player, week) pair:
 *
 *   state = 'ban'        → this player CANNOT submit/edit this week, even
 *                          if the league window is open.
 *   state = 'force_open' → this player CAN submit/edit this week even
 *                          after the Thursday 10:00 WAT deadline, even if
 *                          the league window is closed.
 *
 * Final gate precedence (implemented in a different slice):
 *   1. player ban          → deny.
 *   2. league force_close  → deny.
 *   3. player force_open   → allow.
 *   4. league force_open   → allow.
 *   5. default time-based window.
 *
 * Absence of an active row means "none" (no per-player override).
 *
 * Mutations require permission "squads.player_override.manage"
 * (admin/loc/referee per seed in migration 20260515000100).
 */

export type PlayerOverrideState = "none" | "ban" | "force_open";

export type PlayerSquadOverride = {
  id: string;
  playerId: string;
  weekStartDate: string;
  state: "ban" | "force_open";
  note: string | null;
  setBy: string;
  setAt: string;
};

type Row = {
  id: string;
  player_id: string;
  week_start_date: string;
  state: "ban" | "force_open";
  note: string | null;
  set_by: string;
  set_at: string;
};

const SELECT_COLS =
  "id, player_id, week_start_date, state, note, set_by, set_at";

function toOverride(r: Row): PlayerSquadOverride {
  return {
    id: r.id,
    playerId: r.player_id,
    weekStartDate: r.week_start_date,
    state: r.state,
    note: r.note,
    setBy: r.set_by,
    setAt: r.set_at,
  };
}

export async function getPlayerSquadOverride(
  sb: SupabaseClient,
  playerId: string,
  weekStart: string,
): Promise<PlayerSquadOverride | null> {
  const { data, error } = await sb
    .from("player_squad_overrides")
    .select(SELECT_COLS)
    .eq("player_id", playerId)
    .eq("week_start_date", weekStart)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`getPlayerSquadOverride: ${error.message}`);
  return data ? toOverride(data as Row) : null;
}

export async function setPlayerSquadOverride(
  sb: SupabaseClient,
  actor: Actor,
  playerId: string,
  weekStart: string,
  state: "ban" | "force_open",
  note?: string | null,
): Promise<PlayerSquadOverride> {
  await requirePermAsync(sb, actor, "squads.player_override.manage");
  if (!actor.userId) throw new Error("setPlayerSquadOverride: no actor.userId");

  const nowIso = new Date().toISOString();

  // Resurrection case: a prior row may exist with deleted_at IS NOT NULL.
  // The partial unique index ignores soft-deleted rows, so upsert alone
  // could slot in a second row. Sniff for a soft-deleted sibling first
  // and update in place when we find one.
  const { data: existing, error: existingErr } = await sb
    .from("player_squad_overrides")
    .select("id, deleted_at")
    .eq("player_id", playerId)
    .eq("week_start_date", weekStart)
    .order("set_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingErr) {
    throw new Error(`setPlayerSquadOverride: ${existingErr.message}`);
  }

  if (existing && (existing as { deleted_at: string | null }).deleted_at) {
    const { data: updated, error: updateErr } = await sb
      .from("player_squad_overrides")
      .update({
        state,
        note: note ?? null,
        set_by: actor.userId,
        set_at: nowIso,
        updated_at: nowIso,
        deleted_at: null,
      })
      .eq("id", (existing as { id: string }).id)
      .select(SELECT_COLS)
      .single();
    if (updateErr) {
      throw new Error(`setPlayerSquadOverride: ${updateErr.message}`);
    }
    return toOverride(updated as Row);
  }

  const { data, error } = await sb
    .from("player_squad_overrides")
    .upsert(
      {
        player_id: playerId,
        week_start_date: weekStart,
        state,
        note: note ?? null,
        set_by: actor.userId,
        set_at: nowIso,
        updated_at: nowIso,
        deleted_at: null,
      },
      { onConflict: "player_id,week_start_date" },
    )
    .select(SELECT_COLS)
    .single();
  if (error) throw new Error(`setPlayerSquadOverride: ${error.message}`);
  return toOverride(data as Row);
}

export async function clearPlayerSquadOverride(
  sb: SupabaseClient,
  actor: Actor,
  playerId: string,
  weekStart: string,
): Promise<void> {
  await requirePermAsync(sb, actor, "squads.player_override.manage");
  const nowIso = new Date().toISOString();
  const { error } = await sb
    .from("player_squad_overrides")
    .update({ deleted_at: nowIso, updated_at: nowIso })
    .eq("player_id", playerId)
    .eq("week_start_date", weekStart)
    .is("deleted_at", null);
  if (error) throw new Error(`clearPlayerSquadOverride: ${error.message}`);
}

export async function listPlayerSquadOverridesForWeek(
  sb: SupabaseClient,
  weekStart: string,
): Promise<PlayerSquadOverride[]> {
  const { data, error } = await sb
    .from("player_squad_overrides")
    .select(SELECT_COLS)
    .eq("week_start_date", weekStart)
    .is("deleted_at", null)
    .order("set_at", { ascending: false });
  if (error) {
    throw new Error(`listPlayerSquadOverridesForWeek: ${error.message}`);
  }
  return ((data ?? []) as Row[]).map(toOverride);
}
