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
  // Plan 56 — non-null when the submission was filed against an
  // admin-opened per-match-day window. Plan 10 weekly submissions
  // leave it null. Surfaced on /admin/squads + /admin/squads/[id] so
  // the admin can correlate with the match day's per-MD window panel.
  match_day_id?: string | null;
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
  /** Link back to fc26_players — present when the picker resolved the card
   *  at submit time (Plan 30) or when a ref locked in a candidate via
   *  /admin/squads/[id] (Plan 23). Nullable for legacy / OCR-only flows. */
  resolved_fc_player_id?: string | null;
  /** Optional embedded card-catalogue row. Fetched by the page-level
   *  query via `fc_player:resolved_fc_player_id(...)` so the pitch
   *  visualizer can render the Futbin card art (frame + portrait) for
   *  each slot without an extra per-item round-trip. */
  fc_player?: {
    id: string;
    name: string;
    rating: number;
    position: string;
    item_type: string;
    nation_iso: string | null;
    nation: string | null;
    // 2026-05-09 — club, league, alt_positions are required for the picker's
    // edit-mode hydration to feed full chemistry inputs into LiveTotalsBar's
    // computeChemistry. Without them, edit-mode chem drops to nation-only
    // (~11/33 instead of full ~28-33). Pre-fix, itemToCard hard-coded these
    // to null + [], silently regressing chem on every edit/clone flow.
    club: string | null;
    league: string | null;
    alt_positions: string[] | null;
    attributes: Record<string, unknown> | null;
  } | null;
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
      `id, season_id, player_id, week_start_date, match_day_id,
       futbin_screenshot_path,
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
      `id, season_id, player_id, week_start_date, match_day_id,
       futbin_screenshot_path,
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
    .select(
      `id, submission_id, name, rating, position, value, item_type,
       nationality_flag, slot_index, resolved_fc_player_id,
       fc_player:resolved_fc_player_id (
         id, name, rating, position, item_type, nation_iso, nation, club, league, alt_positions, attributes
       )`,
    )
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
    items: normalizeItems(items),
  };
}

/**
 * Supabase-js types embedded FK joins as arrays by default (see
 * tasks/lessons.md 2026-04-26). `fc_player:resolved_fc_player_id(...)` is a
 * many-to-one embed so PostgREST actually returns a single object, but the
 * generated TS types still allow either. Normalize to a single object once
 * so every page-level consumer can deref `items[i].fc_player?.name` without
 * array-shape gymnastics.
 */
function normalizeItems(raw: unknown): SquadItemRow[] {
  const rows = (raw ?? []) as Array<
    Omit<SquadItemRow, "fc_player"> & {
      fc_player?:
        | SquadItemRow["fc_player"]
        | NonNullable<SquadItemRow["fc_player"]>[]
        | null;
    }
  >;
  return rows.map((r) => {
    const fp = r.fc_player;
    const single = Array.isArray(fp) ? fp[0] ?? null : fp ?? null;
    return { ...r, fc_player: single } as SquadItemRow;
  });
}

export async function getApprovedSubmissionForPlayer(
  sb: SupabaseClient,
  playerId: string,
  weekStart: string,
): Promise<{ submission: SubmissionRow; items: SquadItemRow[] } | null> {
  // Migration 20260801000020 split the legacy weekly unique index, so a
  // single Thursday-anchor week can carry multiple approved submissions
  // (Sat + Sun each with their own match_day_id). Pre-fix `.maybeSingle()`
  // crashed every public `/players/<id>` page that ran this lookup once
  // both weekend submissions were approved. Pick the most recent so the
  // public profile reflects the latest approved squad.
  const { data: rows, error } = await sb
    .from("squad_submissions")
    .select(
      `id, season_id, player_id, week_start_date, match_day_id,
       futbin_screenshot_path,
       submitted_at, validation_status, validated_by, validated_at,
       rejection_reason, notes`,
    )
    .eq("player_id", playerId)
    .eq("week_start_date", weekStart)
    .eq("validation_status", "approved")
    .is("deleted_at", null)
    .order("submitted_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`getApprovedSubmissionForPlayer: ${error.message}`);
  const sub = (rows as unknown as Array<Record<string, unknown>>)?.[0] ?? null;
  if (!sub) return null;

  const { data: items, error: iErr } = await sb
    .from("squad_player_items")
    .select(
      `id, submission_id, name, rating, position, value, item_type,
       nationality_flag, slot_index, resolved_fc_player_id,
       fc_player:resolved_fc_player_id (
         id, name, rating, position, item_type, nation_iso, nation, club, league, alt_positions, attributes
       )`,
    )
    .eq("submission_id", sub.id)
    .is("deleted_at", null)
    .order("slot_index", { ascending: true });
  if (iErr) throw new Error(`getApprovedSubmissionForPlayer items: ${iErr.message}`);

  return {
    submission: sub as unknown as SubmissionRow,
    items: normalizeItems(items),
  };
}

/**
 * Plan 56 — list every live submission a player has filed in the given season,
 * keyed by `match_day_id`. Used by `/player/squad` to render the match-day
 * picker (one row per match day showing whether the player submitted yet).
 *
 * Legacy weekly submissions (filed before the per-match-day path landed in
 * Plan 11) carry a NULL `match_day_id`. We surface those under a synthetic
 * key prefix `week:<YYYY-MM-DD>` so the page can still link them to the
 * picker row whose `match_date`'s Thursday-anchor matches the legacy
 * `week_start_date`.
 *
 * The starting-XI items are NOT loaded here — the per-MD `?matchDay=<id>`
 * detail view re-loads them via `getCurrentWeekSubmissionForPlayer` (or a
 * future `getSubmissionForPlayerAndMatchDay`). Listing all 13×items rows for
 * an entire season would balloon the page payload. We only carry the
 * submission row's id + status + submitted_at + match_day_id + week
 * anchor — enough to render status pills + link to the detail view.
 */
export type PlayerSubmissionSummary = {
  submissionId: string;
  matchDayId: string | null;
  weekStartDate: string;
  submittedAt: string;
  validationStatus: "pending" | "approved" | "rejected";
  rejectionReason: string | null;
};

export async function listSubmissionsForPlayerInSeason(
  sb: SupabaseClient,
  playerId: string,
  seasonId: string,
): Promise<Map<string, PlayerSubmissionSummary>> {
  const { data, error } = await sb
    .from("squad_submissions")
    .select(
      `id, match_day_id, week_start_date, submitted_at,
       validation_status, rejection_reason`,
    )
    .eq("player_id", playerId)
    .eq("season_id", seasonId)
    .is("deleted_at", null)
    .order("submitted_at", { ascending: false });
  if (error) {
    throw new Error(`listSubmissionsForPlayerInSeason: ${error.message}`);
  }
  type Row = {
    id: string;
    match_day_id: string | null;
    week_start_date: string;
    submitted_at: string;
    validation_status: "pending" | "approved" | "rejected";
    rejection_reason: string | null;
  };
  const out = new Map<string, PlayerSubmissionSummary>();
  for (const r of (data ?? []) as Row[]) {
    const summary: PlayerSubmissionSummary = {
      submissionId: r.id,
      matchDayId: r.match_day_id,
      weekStartDate: r.week_start_date,
      submittedAt: r.submitted_at,
      validationStatus: r.validation_status,
      rejectionReason: r.rejection_reason,
    };
    // Primary key: match_day_id when set, else synthetic week anchor. The
    // page-level resolver then maps each match day to either its direct
    // match_day_id key OR (if the row is legacy weekly) the week-anchor key
    // derived from the match day's date.
    const key = r.match_day_id ?? `week:${r.week_start_date}`;
    // First write wins (rows are ordered submitted_at DESC, so the newest
    // submission for the key takes precedence when multiple soft-deletes
    // shake out in unexpected ways).
    if (!out.has(key)) out.set(key, summary);
  }
  return out;
}

/**
 * Plan 56 — load a single submission for `(player, match_day)` with items.
 * Used by the per-MD detail view on `/player/squad?matchDay=<id>`.
 *
 * Falls back to the legacy week-anchor lookup when no row is stamped with
 * the given `matchDayId` — older submissions filed via the weekly path
 * have `match_day_id = NULL`. Caller passes the match day's
 * `match_date` so we can derive the Thursday anchor.
 */
export async function getSubmissionForPlayerAndMatchDay(
  sb: SupabaseClient,
  playerId: string,
  matchDayId: string,
  weekStart: string,
): Promise<{ submission: SubmissionRow; items: SquadItemRow[] } | null> {
  // 1. Direct match on match_day_id (preferred).
  const direct = await sb
    .from("squad_submissions")
    .select(
      `id, season_id, player_id, week_start_date, match_day_id,
       futbin_screenshot_path,
       submitted_at, validation_status, validated_by, validated_at,
       rejection_reason, notes`,
    )
    .eq("player_id", playerId)
    .eq("match_day_id", matchDayId)
    .is("deleted_at", null)
    .maybeSingle();
  if (direct.error) {
    throw new Error(`getSubmissionForPlayerAndMatchDay: ${direct.error.message}`);
  }
  let sub = direct.data;

  // 2. Legacy fallback — older weekly submissions have no match_day_id.
  //    Match by week anchor. Only used when the direct lookup whiffs.
  if (!sub) {
    const fallback = await sb
      .from("squad_submissions")
      .select(
        `id, season_id, player_id, week_start_date, match_day_id,
         futbin_screenshot_path,
         submitted_at, validation_status, validated_by, validated_at,
         rejection_reason, notes`,
      )
      .eq("player_id", playerId)
      .eq("week_start_date", weekStart)
      .is("match_day_id", null)
      .is("deleted_at", null)
      .maybeSingle();
    if (fallback.error) {
      throw new Error(
        `getSubmissionForPlayerAndMatchDay (legacy): ${fallback.error.message}`,
      );
    }
    sub = fallback.data;
  }
  if (!sub) return null;

  const { data: items, error: iErr } = await sb
    .from("squad_player_items")
    .select(
      `id, submission_id, name, rating, position, value, item_type,
       nationality_flag, slot_index, resolved_fc_player_id,
       fc_player:resolved_fc_player_id (
         id, name, rating, position, item_type, nation_iso, nation, club, league, alt_positions, attributes
       )`,
    )
    .eq("submission_id", sub.id)
    .is("deleted_at", null)
    .order("slot_index", { ascending: true });
  if (iErr) {
    throw new Error(
      `getSubmissionForPlayerAndMatchDay items: ${iErr.message}`,
    );
  }
  return {
    submission: sub as unknown as SubmissionRow,
    items: normalizeItems(items),
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
      `id, season_id, player_id, week_start_date, match_day_id,
       futbin_screenshot_path,
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
    .select(
      `id, submission_id, name, rating, position, value, item_type,
       nationality_flag, slot_index, resolved_fc_player_id,
       fc_player:resolved_fc_player_id (
         id, name, rating, position, item_type, nation_iso, nation, club, league, alt_positions, attributes
       )`,
    )
    .eq("submission_id", sub.id)
    .is("deleted_at", null)
    .order("slot_index", { ascending: true });
  if (iErr) throw new Error(`getCurrentWeekSubmissionForPlayer items: ${iErr.message}`);

  return {
    submission: sub as unknown as SubmissionRow,
    items: normalizeItems(items),
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
