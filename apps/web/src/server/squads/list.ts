import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Plan 10 — read helpers. Admin lists, player lookups, and public
 * (approved-only) week-current fetch.
 */

export type SubmissionRow = {
  id: string;
  season_id: string;
  player_id: string;
  week_start_date: string;
  futbin_screenshot_path: string;
  submitted_at: string;
  validation_status: "pending" | "approved" | "rejected";
  validated_by: string | null;
  validated_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  player?: {
    id: string;
    display_name: string;
    gamer_tag: string;
  };
};

export type SquadItemRow = {
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

export async function listSubmissionsForWeek(
  sb: SupabaseClient,
  seasonId: string,
  weekStart: string,
  opts: { status?: "pending" | "approved" | "rejected" } = {},
): Promise<SubmissionRow[]> {
  let q = sb
    .from("squad_submissions")
    .select(
      `id, season_id, player_id, week_start_date, futbin_screenshot_path,
       submitted_at, validation_status, validated_by, validated_at,
       rejection_reason, notes,
       player:player_id (id, gamer_tag, users:users!players_user_id_fkey (display_name))`,
    )
    .eq("season_id", seasonId)
    .eq("week_start_date", weekStart)
    .is("deleted_at", null)
    .order("submitted_at", { ascending: false });
  if (opts.status) q = q.eq("validation_status", opts.status);
  const { data, error } = await q;
  if (error) throw new Error(`listSubmissionsForWeek: ${error.message}`);
  // The embedded shape is `{ player: { id, gamer_tag, users: { display_name } } }`;
  // flatten to the public `{ player: { id, display_name, gamer_tag } }` shape.
  type Nested = Omit<SubmissionRow, "player"> & {
    player:
      | {
          id: string;
          gamer_tag: string;
          users: { display_name: string | null } | null;
        }
      | null;
  };
  return ((data ?? []) as unknown as Nested[]).map((r) => ({
    ...r,
    player: r.player
      ? {
          id: r.player.id,
          display_name: r.player.users?.display_name ?? r.player.gamer_tag,
          gamer_tag: r.player.gamer_tag,
        }
      : undefined,
  }));
}

export async function getSubmissionWithItems(
  sb: SupabaseClient,
  submissionId: string,
): Promise<{ submission: SubmissionRow; items: SquadItemRow[] } | null> {
  const { data: sub, error: sErr } = await sb
    .from("squad_submissions")
    .select(
      `id, season_id, player_id, week_start_date, futbin_screenshot_path,
       submitted_at, validation_status, validated_by, validated_at,
       rejection_reason, notes,
       player:player_id (id, gamer_tag, users:users!players_user_id_fkey (display_name))`,
    )
    .eq("id", submissionId)
    .is("deleted_at", null)
    .maybeSingle();
  if (sErr) throw new Error(`getSubmissionWithItems: ${sErr.message}`);
  if (!sub) return null;

  const { data: items, error: iErr } = await sb
    .from("squad_player_items")
    .select("id, submission_id, name, rating, position, value, item_type, nationality_flag, slot_index")
    .eq("submission_id", submissionId)
    .is("deleted_at", null)
    .order("slot_index", { ascending: true });
  if (iErr) throw new Error(`getSubmissionWithItems items: ${iErr.message}`);

  // Flatten embedded `users.display_name` into the public `player` shape.
  type Nested = Omit<SubmissionRow, "player"> & {
    player:
      | {
          id: string;
          gamer_tag: string;
          users: { display_name: string | null } | null;
        }
      | null;
  };
  const nested = sub as unknown as Nested;
  const submission: SubmissionRow = {
    ...nested,
    player: nested.player
      ? {
          id: nested.player.id,
          display_name: nested.player.users?.display_name ?? nested.player.gamer_tag,
          gamer_tag: nested.player.gamer_tag,
        }
      : undefined,
  };

  return {
    submission,
    items: (items ?? []) as SquadItemRow[],
  };
}

export async function getApprovedSubmissionForPlayer(
  sb: SupabaseClient,
  playerId: string,
  weekStart: string,
): Promise<{ submission: SubmissionRow; items: SquadItemRow[] } | null> {
  const { data: sub, error } = await sb
    .from("squad_submissions")
    .select(
      `id, season_id, player_id, week_start_date, futbin_screenshot_path,
       submitted_at, validation_status, validated_by, validated_at,
       rejection_reason, notes`,
    )
    .eq("player_id", playerId)
    .eq("week_start_date", weekStart)
    .eq("validation_status", "approved")
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`getApprovedSubmissionForPlayer: ${error.message}`);
  if (!sub) return null;

  const { data: items, error: iErr } = await sb
    .from("squad_player_items")
    .select("id, submission_id, name, rating, position, value, item_type, nationality_flag, slot_index")
    .eq("submission_id", sub.id)
    .is("deleted_at", null)
    .order("slot_index", { ascending: true });
  if (iErr) throw new Error(`getApprovedSubmissionForPlayer items: ${iErr.message}`);

  return {
    submission: sub as unknown as SubmissionRow,
    items: (items ?? []) as SquadItemRow[],
  };
}

export async function getCurrentWeekSubmissionForPlayer(
  sb: SupabaseClient,
  playerId: string,
  weekStart: string,
): Promise<{ submission: SubmissionRow; items: SquadItemRow[] } | null> {
  const { data: sub, error } = await sb
    .from("squad_submissions")
    .select(
      `id, season_id, player_id, week_start_date, futbin_screenshot_path,
       submitted_at, validation_status, validated_by, validated_at,
       rejection_reason, notes`,
    )
    .eq("player_id", playerId)
    .eq("week_start_date", weekStart)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`getCurrentWeekSubmissionForPlayer: ${error.message}`);
  if (!sub) return null;

  const { data: items, error: iErr } = await sb
    .from("squad_player_items")
    .select("id, submission_id, name, rating, position, value, item_type, nationality_flag, slot_index")
    .eq("submission_id", sub.id)
    .is("deleted_at", null)
    .order("slot_index", { ascending: true });
  if (iErr) throw new Error(`getCurrentWeekSubmissionForPlayer items: ${iErr.message}`);

  return {
    submission: sub as unknown as SubmissionRow,
    items: (items ?? []) as SquadItemRow[],
  };
}

/**
 * List users that currently have the `squads.change_authorize` permission.
 * Used by the player change-window form to populate the referee dropdown.
 */
export async function listChangeAuthorizingRefs(
  sb: SupabaseClient,
): Promise<Array<{ id: string; display_name: string }>> {
  const { data: perms, error: pErr } = await sb
    .from("role_permissions")
    .select("role")
    .eq("permission", "squads.change_authorize");
  if (pErr) throw new Error(`listChangeAuthorizingRefs perms: ${pErr.message}`);
  const roles = Array.from(new Set((perms ?? []).map((r: { role: string }) => r.role)));
  if (roles.length === 0) return [];

  const { data: rows, error: rErr } = await sb
    .from("user_roles")
    .select("user_id, users:user_id (id, display_name)")
    .in("role", roles)
    .is("deleted_at", null);
  if (rErr) throw new Error(`listChangeAuthorizingRefs users: ${rErr.message}`);

  type Row = { user_id: string; users: { id: string; display_name: string } | null };
  const seen = new Set<string>();
  const out: Array<{ id: string; display_name: string }> = [];
  for (const r of (rows ?? []) as unknown as Row[]) {
    if (!r.users?.id || seen.has(r.users.id)) continue;
    seen.add(r.users.id);
    out.push({ id: r.users.id, display_name: r.users.display_name });
  }
  return out;
}
