import type { SupabaseClient } from "@supabase/supabase-js";
import { createContractSchema, type CreateContractInput } from "./schemas";

export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractError";
  }
}

export type OrgContractRow = {
  id: string;
  organization_id: string;
  player_id: string;
  season_id: string;
  contract_url: string;
  signed_at: string | null;
  valid_from: string;
  valid_until: string;
  status: "draft" | "active" | "terminated" | "expired";
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export async function createContract(
  sb: SupabaseClient,
  raw: CreateContractInput,
): Promise<OrgContractRow> {
  const input = createContractSchema.parse(raw);

  if (input.validFrom > input.validUntil) {
    throw new ContractError("validFrom must be <= validUntil");
  }

  const { data, error } = await sb
    .from("organization_contracts")
    .insert({
      organization_id: input.organizationId,
      player_id: input.playerId,
      season_id: input.seasonId,
      contract_url: input.contractUrl,
      valid_from: input.validFrom,
      valid_until: input.validUntil,
      status: input.status,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new ContractError(`createContract: ${error?.message ?? "unknown"}`);
  }
  return data as OrgContractRow;
}

/**
 * Activate a draft contract. Server enforces "one active contract per
 * (player, season)" by pre-flighting a read — the partial unique index on
 * the table is the authoritative backstop.
 */
export async function activateContract(
  sb: SupabaseClient,
  contractId: string,
): Promise<OrgContractRow> {
  // Load target so we can check (player, season) uniqueness.
  const { data: target, error: tErr } = await sb
    .from("organization_contracts")
    .select("id, player_id, season_id, status")
    .eq("id", contractId)
    .maybeSingle();
  if (tErr) throw new ContractError(`activateContract read: ${tErr.message}`);
  if (!target) throw new ContractError(`contract not found: ${contractId}`);

  const t = target as {
    id: string;
    player_id: string;
    season_id: string;
    status: string;
  };
  if (t.status === "active") return t as unknown as OrgContractRow;

  const { data: existing, error: exErr } = await sb
    .from("organization_contracts")
    .select("id")
    .eq("player_id", t.player_id)
    .eq("season_id", t.season_id)
    .eq("status", "active")
    .is("deleted_at", null)
    .neq("id", contractId)
    .maybeSingle();
  if (exErr) throw new ContractError(`activateContract check: ${exErr.message}`);
  if (existing) {
    throw new ContractError(
      `player ${t.player_id} already has an active contract for season ${t.season_id}`,
    );
  }

  const { data, error } = await sb
    .from("organization_contracts")
    .update({
      status: "active",
      signed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", contractId)
    .select("*")
    .single();
  if (error || !data) {
    throw new ContractError(
      `activateContract update: ${error?.message ?? "unknown"}`,
    );
  }
  return data as OrgContractRow;
}

export async function terminateContract(
  sb: SupabaseClient,
  contractId: string,
): Promise<void> {
  const { error } = await sb
    .from("organization_contracts")
    .update({
      status: "terminated",
      updated_at: new Date().toISOString(),
    })
    .eq("id", contractId);
  if (error) throw new ContractError(`terminateContract: ${error.message}`);
}

export async function listContractsForPlayer(
  sb: SupabaseClient,
  playerId: string,
): Promise<OrgContractRow[]> {
  const { data, error } = await sb
    .from("organization_contracts")
    .select("*")
    .eq("player_id", playerId)
    .is("deleted_at", null)
    .order("valid_from", { ascending: false });
  if (error) {
    throw new ContractError(`listContractsForPlayer: ${error.message}`);
  }
  return (data ?? []) as OrgContractRow[];
}

export async function listContractsForOrg(
  sb: SupabaseClient,
  orgId: string,
): Promise<OrgContractRow[]> {
  const { data, error } = await sb
    .from("organization_contracts")
    .select("*")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .order("valid_from", { ascending: false });
  if (error) throw new ContractError(`listContractsForOrg: ${error.message}`);
  return (data ?? []) as OrgContractRow[];
}
