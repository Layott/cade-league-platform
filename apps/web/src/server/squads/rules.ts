import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePermAsync } from "@/lib/perms-db";
import type { Actor } from "@/perms";
import { ruleUpsertSchema, type RuleUpsertInput } from "./schemas";
import { ValidationError } from "./errors";

/**
 * Plan 10 — squad_validation_rules read + upsert. One live row per season
 * (partial unique index guarantees). Upsert is admin-only via perm
 * `squads.rules_edit` (falls back to admin wildcard).
 */

export type SquadRuleRow = {
  id: string;
  season_id: string;
  max_budget_coins: number;
  min_nigerian_items: number;
  banned_item_types: string[];
  notes: string | null;
};

export async function getRuleForSeason(
  sb: SupabaseClient,
  seasonId: string,
): Promise<SquadRuleRow | null> {
  const { data, error } = await sb
    .from("squad_validation_rules")
    .select("id, season_id, max_budget_coins, min_nigerian_items, banned_item_types, notes")
    .eq("season_id", seasonId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`getRuleForSeason failed: ${error.message}`);
  return (data as SquadRuleRow | null) ?? null;
}

export async function upsertRule(
  sb: SupabaseClient,
  actor: Actor,
  input: RuleUpsertInput,
): Promise<SquadRuleRow> {
  await requirePermAsync(sb, actor, "squads.rules_edit");
  const parsed = ruleUpsertSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "invalid rule");
  }
  const v = parsed.data;

  const existing = await getRuleForSeason(sb, v.seasonId);
  if (existing) {
    const { data, error } = await sb
      .from("squad_validation_rules")
      .update({
        max_budget_coins: v.maxBudgetCoins,
        min_nigerian_items: v.minNigerianItems,
        banned_item_types: v.bannedItemTypes,
        notes: v.notes ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("id, season_id, max_budget_coins, min_nigerian_items, banned_item_types, notes")
      .single();
    if (error || !data) throw new Error(`upsertRule update failed: ${error?.message}`);
    return data as SquadRuleRow;
  }

  const { data, error } = await sb
    .from("squad_validation_rules")
    .insert({
      season_id: v.seasonId,
      max_budget_coins: v.maxBudgetCoins,
      min_nigerian_items: v.minNigerianItems,
      banned_item_types: v.bannedItemTypes,
      notes: v.notes ?? null,
    })
    .select("id, season_id, max_budget_coins, min_nigerian_items, banned_item_types, notes")
    .single();
  if (error || !data) throw new Error(`upsertRule insert failed: ${error?.message}`);
  return data as SquadRuleRow;
}
