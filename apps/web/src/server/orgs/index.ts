import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createOrgSchema,
  updateOrgSchema,
  linkPlayerSchema,
  linkCoachSchema,
  linkTeamManagerSchema,
  type CreateOrgInput,
  type UpdateOrgInput,
  type LinkPlayerInput,
  type LinkCoachInput,
  type LinkTeamManagerInput,
} from "./schemas";

export class OrgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrgError";
  }
}

export type OrgRow = {
  id: string;
  name: string;
  // Plan 31 — CAC fields removed; logo_url replaces them as the org's
  // public-facing identity asset.
  logo_url: string | null;
  contact_rep_user_id: string | null;
  status: "active" | "suspended" | "dissolved";
  caution_fee_balance_coins: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export async function createOrg(
  sb: SupabaseClient,
  raw: CreateOrgInput,
): Promise<OrgRow> {
  const input = createOrgSchema.parse(raw);
  const { data, error } = await sb
    .from("organizations")
    .insert({
      name: input.name,
      logo_url: input.logoUrl ?? null,
      contact_rep_user_id: input.contactRepUserId ?? null,
      status: input.status,
    })
    .select("*")
    .single();
  if (error || !data) throw new OrgError(`createOrg: ${error?.message ?? "unknown"}`);
  return data as OrgRow;
}

export async function updateOrg(
  sb: SupabaseClient,
  raw: UpdateOrgInput,
): Promise<OrgRow> {
  const input = updateOrgSchema.parse(raw);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.logoUrl !== undefined) patch.logo_url = input.logoUrl;
  if (input.contactRepUserId !== undefined) patch.contact_rep_user_id = input.contactRepUserId;
  if (input.status !== undefined) patch.status = input.status;

  const { data, error } = await sb
    .from("organizations")
    .update(patch)
    .eq("id", input.id)
    .select("*")
    .single();
  if (error || !data) throw new OrgError(`updateOrg: ${error?.message ?? "unknown"}`);
  return data as OrgRow;
}

export async function softDeleteOrg(
  sb: SupabaseClient,
  orgId: string,
): Promise<void> {
  const { error } = await sb
    .from("organizations")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", orgId);
  if (error) throw new OrgError(`softDeleteOrg: ${error.message}`);
}

export async function listOrgs(sb: SupabaseClient): Promise<OrgRow[]> {
  const { data, error } = await sb
    .from("organizations")
    .select("*")
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (error) throw new OrgError(`listOrgs: ${error.message}`);
  return (data ?? []) as OrgRow[];
}

export async function getOrgById(
  sb: SupabaseClient,
  orgId: string,
): Promise<OrgRow | null> {
  const { data, error } = await sb
    .from("organizations")
    .select("*")
    .eq("id", orgId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new OrgError(`getOrgById: ${error.message}`);
  return (data as OrgRow | null) ?? null;
}

export async function linkPlayer(
  sb: SupabaseClient,
  raw: LinkPlayerInput,
): Promise<void> {
  const input = linkPlayerSchema.parse(raw);
  const { error } = await sb
    .from("players")
    .update({
      organization_id: input.orgId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.playerId)
    .is("deleted_at", null);
  if (error) throw new OrgError(`linkPlayer: ${error.message}`);
}

export async function unlinkPlayer(
  sb: SupabaseClient,
  playerId: string,
): Promise<void> {
  const { error } = await sb
    .from("players")
    .update({
      organization_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", playerId);
  if (error) throw new OrgError(`unlinkPlayer: ${error.message}`);
}

/**
 * Plan 31 — assign (or clear) a coach for a player.
 * Verifies the player is currently linked to the given org so staff
 * binding stays scoped. Pass `coachUserId: null` to clear.
 */
export async function linkCoach(
  sb: SupabaseClient,
  raw: LinkCoachInput,
): Promise<void> {
  const input = linkCoachSchema.parse(raw);
  const { data: player, error: readErr } = await sb
    .from("players")
    .select("id, organization_id")
    .eq("id", input.playerId)
    .is("deleted_at", null)
    .maybeSingle();
  if (readErr) throw new OrgError(`linkCoach (read): ${readErr.message}`);
  if (!player) throw new OrgError("linkCoach: player not found");
  const p = player as { id: string; organization_id: string | null };
  if (p.organization_id !== input.orgId) {
    throw new OrgError("linkCoach: player not in given org");
  }

  const { error } = await sb
    .from("players")
    .update({
      coach_id: input.coachUserId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.playerId);
  if (error) throw new OrgError(`linkCoach: ${error.message}`);
}

/**
 * Plan 31 — assign (or clear) a team manager for a player. Same scoping
 * rule as linkCoach.
 */
export async function linkTeamManager(
  sb: SupabaseClient,
  raw: LinkTeamManagerInput,
): Promise<void> {
  const input = linkTeamManagerSchema.parse(raw);
  const { data: player, error: readErr } = await sb
    .from("players")
    .select("id, organization_id")
    .eq("id", input.playerId)
    .is("deleted_at", null)
    .maybeSingle();
  if (readErr) throw new OrgError(`linkTeamManager (read): ${readErr.message}`);
  if (!player) throw new OrgError("linkTeamManager: player not found");
  const p = player as { id: string; organization_id: string | null };
  if (p.organization_id !== input.orgId) {
    throw new OrgError("linkTeamManager: player not in given org");
  }

  const { error } = await sb
    .from("players")
    .update({
      team_manager_id: input.teamManagerUserId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.playerId);
  if (error) throw new OrgError(`linkTeamManager: ${error.message}`);
}

export async function listPlayersForOrg(
  sb: SupabaseClient,
  orgId: string,
): Promise<Array<{ id: string; gamer_tag: string; display_name: string }>> {
  const { data, error } = await sb
    .from("players")
    .select("id, gamer_tag, users:users!players_user_id_fkey!inner(display_name)")
    .eq("organization_id", orgId)
    .is("deleted_at", null);
  if (error) throw new OrgError(`listPlayersForOrg: ${error.message}`);

  type Row = {
    id: string;
    gamer_tag: string;
    users: { display_name: string };
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    gamer_tag: r.gamer_tag,
    display_name: r.users.display_name,
  }));
}

// Re-exports for consumers.
export { recordEntry, getBalance, listEntries, LedgerError } from "./ledger";
export type { LedgerEntry } from "./ledger";
export {
  createContract,
  activateContract,
  terminateContract,
  listContractsForPlayer,
  listContractsForOrg,
  ContractError,
} from "./contracts";
export type { OrgContractRow } from "./contracts";
