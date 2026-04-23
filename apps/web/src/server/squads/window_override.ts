import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePermAsync } from "@/lib/perms-db";
import type { Actor } from "@/perms";

/**
 * Admin override for the weekly squad submission window.
 *
 * The default window is time-based (Thursday 10:00 WAT deadline + Friday
 * 21:00-22:00 change window). Admin can force the window open or shut
 * for the current week via this module. Absence of an active row means
 * the default time-based logic applies (state = "auto").
 *
 * Mutations require permission "squads.window.manage" (admin/loc/referee
 * per seed in migration 20260514000100).
 */

export type SquadWindowState = "auto" | "force_open" | "force_close";

export type SquadWindowOverride = {
  weekStartDate: string;
  state: "force_open" | "force_close";
  note: string | null;
  setBy: string;
  setAt: string;
};

type Row = {
  week_start_date: string;
  state: "force_open" | "force_close";
  note: string | null;
  set_by: string;
  set_at: string;
};

function toOverride(r: Row): SquadWindowOverride {
  return {
    weekStartDate: r.week_start_date,
    state: r.state,
    note: r.note,
    setBy: r.set_by,
    setAt: r.set_at,
  };
}

export async function getSquadWindowOverride(
  sb: SupabaseClient,
  weekStart: string,
): Promise<SquadWindowOverride | null> {
  const { data, error } = await sb
    .from("squad_window_overrides")
    .select("week_start_date, state, note, set_by, set_at")
    .eq("week_start_date", weekStart)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`getSquadWindowOverride: ${error.message}`);
  return data ? toOverride(data as Row) : null;
}

export async function setSquadWindowOverride(
  sb: SupabaseClient,
  actor: Actor,
  weekStart: string,
  state: "force_open" | "force_close",
  note?: string | null,
): Promise<SquadWindowOverride> {
  await requirePermAsync(sb, actor, "squads.window.manage");
  if (!actor.userId) throw new Error("setSquadWindowOverride: no actor.userId");

  const nowIso = new Date().toISOString();
  const { data, error } = await sb
    .from("squad_window_overrides")
    .upsert(
      {
        week_start_date: weekStart,
        state,
        note: note ?? null,
        set_by: actor.userId,
        set_at: nowIso,
        updated_at: nowIso,
        deleted_at: null,
      },
      { onConflict: "week_start_date" },
    )
    .select("week_start_date, state, note, set_by, set_at")
    .single();
  if (error) throw new Error(`setSquadWindowOverride: ${error.message}`);
  return toOverride(data as Row);
}

export async function clearSquadWindowOverride(
  sb: SupabaseClient,
  actor: Actor,
  weekStart: string,
): Promise<void> {
  await requirePermAsync(sb, actor, "squads.window.manage");
  const nowIso = new Date().toISOString();
  const { error } = await sb
    .from("squad_window_overrides")
    .update({ deleted_at: nowIso, updated_at: nowIso })
    .eq("week_start_date", weekStart)
    .is("deleted_at", null);
  if (error) throw new Error(`clearSquadWindowOverride: ${error.message}`);
}
