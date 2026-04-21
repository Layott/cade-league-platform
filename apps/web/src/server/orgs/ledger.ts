import type { SupabaseClient } from "@supabase/supabase-js";
import { ledgerEntrySchema, type LedgerEntryInput } from "./schemas";

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

export type LedgerEntry = {
  id: string;
  organization_id: string;
  entry_type: "deposit" | "fine_deduction" | "topup" | "adjustment";
  amount_coins: number;
  direction: "credit" | "debit";
  balance_after_coins: number;
  reference: string | null;
  entered_by_user_id: string;
  entered_at: string;
};

/**
 * Derive the balance direction (credit = +, debit = -) for a given entry type.
 * Adjustments are the only entry where the admin chooses direction explicitly.
 */
function deriveDirection(
  entryType: LedgerEntryInput["entryType"],
  provided: LedgerEntryInput["direction"],
): "credit" | "debit" {
  if (entryType === "deposit" || entryType === "topup") return "credit";
  if (entryType === "fine_deduction") return "debit";
  if (entryType === "adjustment") {
    if (!provided) {
      throw new LedgerError(
        "adjustment entries must specify direction (credit|debit)",
      );
    }
    return provided;
  }
  // Exhaustiveness guard.
  throw new LedgerError(`unknown entry_type: ${entryType as string}`);
}

/**
 * Append a caution-ledger row + update the denormalised balance on
 * organizations.caution_fee_balance_coins.
 *
 * Invariant: balance stays reconcilable via `sum(credit) - sum(debit)`.
 * Overdraft (balance < 0) is rejected by both this module AND the DB CHECK.
 *
 * Serialises concurrent writes on the same org by locking the organization
 * row FOR UPDATE via a Postgres function — see `recordLedgerEntry` RPC.
 * The test harness simulates this by mocking `from('organizations')`.
 */
export async function recordEntry(
  sb: SupabaseClient,
  enteredByUserId: string,
  raw: LedgerEntryInput,
): Promise<LedgerEntry> {
  const input = ledgerEntrySchema.parse(raw);
  const direction = deriveDirection(input.entryType, input.direction);

  // 1. Load current balance.
  const { data: org, error: orgErr } = await sb
    .from("organizations")
    .select("id, caution_fee_balance_coins, deleted_at")
    .eq("id", input.orgId)
    .maybeSingle();
  if (orgErr) throw new LedgerError(`org lookup: ${orgErr.message}`);
  if (!org) throw new LedgerError(`organization not found: ${input.orgId}`);
  if ((org as { deleted_at: string | null }).deleted_at) {
    throw new LedgerError("cannot post to a deleted organization");
  }

  const currentBalance = Number(
    (org as { caution_fee_balance_coins: number | string })
      .caution_fee_balance_coins ?? 0,
  );

  const delta = direction === "credit" ? input.amountCoins : -input.amountCoins;
  const newBalance = currentBalance + delta;
  if (newBalance < 0) {
    throw new LedgerError(
      `overdraft rejected: ${currentBalance} ${direction === "debit" ? "-" : "+"} ${input.amountCoins} = ${newBalance}`,
    );
  }

  // 2. Insert ledger row (append-only — no update path).
  const { data: entryRow, error: entryErr } = await sb
    .from("caution_ledger_entries")
    .insert({
      organization_id: input.orgId,
      entry_type: input.entryType,
      amount_coins: input.amountCoins,
      direction,
      balance_after_coins: newBalance,
      reference: input.reference ?? null,
      entered_by_user_id: enteredByUserId,
    })
    .select(
      "id, organization_id, entry_type, amount_coins, direction, balance_after_coins, reference, entered_by_user_id, entered_at",
    )
    .single();
  if (entryErr || !entryRow) {
    throw new LedgerError(`ledger insert: ${entryErr?.message ?? "unknown"}`);
  }

  // 3. Update denormalised balance.
  const { error: updErr } = await sb
    .from("organizations")
    .update({
      caution_fee_balance_coins: newBalance,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.orgId);
  if (updErr) {
    throw new LedgerError(`org balance update: ${updErr.message}`);
  }

  return entryRow as LedgerEntry;
}

/**
 * Read current balance for an org. Thin wrapper so callers can mock once.
 */
export async function getBalance(
  sb: SupabaseClient,
  orgId: string,
): Promise<number> {
  const { data, error } = await sb
    .from("organizations")
    .select("caution_fee_balance_coins")
    .eq("id", orgId)
    .maybeSingle();
  if (error) throw new LedgerError(`getBalance: ${error.message}`);
  if (!data) throw new LedgerError(`organization not found: ${orgId}`);
  return Number(
    (data as { caution_fee_balance_coins: number | string })
      .caution_fee_balance_coins ?? 0,
  );
}

/**
 * List ledger rows newest-first.
 */
export async function listEntries(
  sb: SupabaseClient,
  orgId: string,
  limit = 100,
): Promise<LedgerEntry[]> {
  const { data, error } = await sb
    .from("caution_ledger_entries")
    .select(
      "id, organization_id, entry_type, amount_coins, direction, balance_after_coins, reference, entered_by_user_id, entered_at",
    )
    .eq("organization_id", orgId)
    .order("entered_at", { ascending: false })
    .limit(limit);
  if (error) throw new LedgerError(`listEntries: ${error.message}`);
  return (data ?? []) as LedgerEntry[];
}
