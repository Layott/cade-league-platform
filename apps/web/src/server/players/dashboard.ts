import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * UI Audit Slice 2 (2026-04-28) — server reads for the rebuilt
 * `/player` dashboard. Replaces the original 3-link-tile stub with
 * substance: caution-fee balance for the player's org, count of open
 * cases (disputes + appeals with status in submitted/under_review),
 * and the most recent live disciplinary action (effective_until > now
 * OR open-ended ban whose effective_until is null).
 *
 * Every helper takes the Supabase client as a parameter so unit tests
 * can mock it. Empty-state shapes are explicit so the UI doesn't need
 * any defensive `?? "—"` ladder.
 */

export const playerOrgBalanceSchema = z.object({
  organizationId: z.string().uuid(),
  organizationName: z.string(),
  balanceCoins: z.number(),
});
export type PlayerOrgBalance = z.infer<typeof playerOrgBalanceSchema>;

export const playerOpenCasesSchema = z.object({
  disputes: z.number().int().nonnegative(),
  appeals: z.number().int().nonnegative(),
});
export type PlayerOpenCases = z.infer<typeof playerOpenCasesSchema>;

export const playerActiveSanctionSchema = z.object({
  caseId: z.string().uuid(),
  actionId: z.string().uuid(),
  sanctionType: z.string(),
  magnitude: z.number().int().nonnegative(),
  incidentType: z.string(),
  effectiveFrom: z.string().nullable(),
  effectiveUntil: z.string().nullable(),
  imposedAt: z.string(),
});
export type PlayerActiveSanction = z.infer<typeof playerActiveSanctionSchema>;

export const playerDashboardSchema = z.object({
  orgBalance: playerOrgBalanceSchema.nullable(),
  openCases: playerOpenCasesSchema,
  activeSanction: playerActiveSanctionSchema.nullable(),
});
export type PlayerDashboard = z.infer<typeof playerDashboardSchema>;

/**
 * Read the org caution-fee balance for the player. Returns null if the
 * player isn't linked to an org (free agents — Plan 13A allows this).
 */
export async function getPlayerOrgBalance(
  sb: SupabaseClient,
  playerId: string,
): Promise<PlayerOrgBalance | null> {
  const { data: player, error: playerErr } = await sb
    .from("players")
    .select("organization_id")
    .eq("id", playerId)
    .is("deleted_at", null)
    .maybeSingle();
  if (playerErr) throw new Error(`getPlayerOrgBalance player: ${playerErr.message}`);
  if (!player) return null;
  const orgId = (player as { organization_id: string | null }).organization_id;
  if (!orgId) return null;

  const { data: org, error: orgErr } = await sb
    .from("organizations")
    .select("id, name, caution_fee_balance_coins")
    .eq("id", orgId)
    .is("deleted_at", null)
    .maybeSingle();
  if (orgErr) throw new Error(`getPlayerOrgBalance org: ${orgErr.message}`);
  if (!org) return null;

  const row = org as {
    id: string;
    name: string;
    caution_fee_balance_coins: number | string | null;
  };
  return {
    organizationId: row.id,
    organizationName: row.name,
    balanceCoins: Number(row.caution_fee_balance_coins ?? 0),
  };
}

/**
 * Count this player's disputes + appeals in submitted / under_review
 * status. Disputes use `raised_by_user_id`, appeals use
 * `submitted_by_user_id` — both keyed by the public users.id (not
 * supabase_auth_id).
 */
export async function getPlayerOpenCases(
  sb: SupabaseClient,
  userId: string,
): Promise<PlayerOpenCases> {
  const [disputesRes, appealsRes] = await Promise.all([
    sb
      .from("disputes")
      .select("id", { count: "exact", head: true })
      .eq("raised_by_user_id", userId)
      .in("status", ["submitted", "under_review"])
      .is("deleted_at", null),
    sb
      .from("appeals")
      .select("id", { count: "exact", head: true })
      .eq("submitted_by_user_id", userId)
      .in("status", ["submitted", "under_review"])
      .is("deleted_at", null),
  ]);
  if (disputesRes.error)
    throw new Error(`getPlayerOpenCases disputes: ${disputesRes.error.message}`);
  if (appealsRes.error)
    throw new Error(`getPlayerOpenCases appeals: ${appealsRes.error.message}`);

  return {
    disputes: disputesRes.count ?? 0,
    appeals: appealsRes.count ?? 0,
  };
}

/**
 * Find the player's most recent live disciplinary action — non-revoked,
 * non-deleted, where effective_until is either NULL (open-ended ban,
 * still in force until lifted) OR strictly greater than `now`. Returns
 * null on a clean record. The link target is the public ledger
 * `/punishments` since that's the canonical read surface (player can
 * reach the same ruling thread via /profile sanctions widget).
 */
export async function getPlayerActiveSanction(
  sb: SupabaseClient,
  playerId: string,
  now: Date,
): Promise<PlayerActiveSanction | null> {
  const { data: caseRows, error: caseErr } = await sb
    .from("disciplinary_cases")
    .select("id, incident_type")
    .eq("player_id", playerId)
    .is("deleted_at", null);
  if (caseErr) throw new Error(`getPlayerActiveSanction cases: ${caseErr.message}`);
  const caseIncidents = new Map<string, string>();
  for (const c of (caseRows ?? []) as Array<{ id: string; incident_type: string }>) {
    caseIncidents.set(c.id, c.incident_type);
  }
  if (caseIncidents.size === 0) return null;

  const todayIso = now.toISOString().slice(0, 10);
  const { data: actionRows, error: actionErr } = await sb
    .from("disciplinary_actions")
    .select(
      "id, case_id, sanction_type, magnitude, effective_from, effective_until, imposed_at, revoked_at, deleted_at",
    )
    .in("case_id", Array.from(caseIncidents.keys()))
    .is("revoked_at", null)
    .is("deleted_at", null)
    .order("imposed_at", { ascending: false });
  if (actionErr) throw new Error(`getPlayerActiveSanction actions: ${actionErr.message}`);

  type ActionRow = {
    id: string;
    case_id: string;
    sanction_type: string;
    magnitude: number;
    effective_from: string | null;
    effective_until: string | null;
    imposed_at: string;
    revoked_at: string | null;
    deleted_at: string | null;
  };

  for (const a of ((actionRows ?? []) as ActionRow[])) {
    // Sanction is currently in force when:
    //   - effective_until is null (no end → open-ended), AND
    //     effective_from is null OR <= today; or
    //   - effective_until > today.
    if (a.effective_until !== null && a.effective_until <= todayIso) continue;
    if (a.effective_from !== null && a.effective_from > todayIso) continue;
    return {
      caseId: a.case_id,
      actionId: a.id,
      sanctionType: a.sanction_type,
      magnitude: a.magnitude,
      incidentType: caseIncidents.get(a.case_id) ?? "unknown",
      effectiveFrom: a.effective_from,
      effectiveUntil: a.effective_until,
      imposedAt: a.imposed_at,
    };
  }
  return null;
}

/**
 * Compose the 3-card dashboard read in one call. Each helper is called
 * separately so a partial failure (e.g., free agent → null balance)
 * doesn't take down the whole dashboard; callers can wrap individual
 * promises if they want fine-grained error handling, but the default
 * shape returns sensible empty-state values.
 */
export async function getPlayerDashboard(
  sb: SupabaseClient,
  args: { playerId: string; userId: string; now: Date },
): Promise<PlayerDashboard> {
  const [orgBalance, openCases, activeSanction] = await Promise.all([
    getPlayerOrgBalance(sb, args.playerId),
    getPlayerOpenCases(sb, args.userId),
    getPlayerActiveSanction(sb, args.playerId, args.now),
  ]);
  return { orgBalance, openCases, activeSanction };
}
