import { getServerSupabase } from "@/lib/supabase/server";
import { getRuleForSeason } from "@/server/squads";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { FormField, inputClass, textareaClass } from "@/components/admin/FormField";
import { PrimaryButton } from "@/components/admin/buttons";
import { saveRuleAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminSquadsRulesPage() {
  const sb = await getServerSupabase();
  const { data: season } = await sb
    .from("seasons")
    .select("id, year_range")
    .is("deleted_at", null)
    .eq("status", "active")
    .maybeSingle();

  const rule = season ? await getRuleForSeason(sb, season.id) : null;

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Config"
        title="Squad validation rules"
        description={
          season
            ? `Elite ${season.year_range} — one live row per season.`
            : "No active season — create one under /admin/seasons first."
        }
      />

      {season ? (
        <form action={saveRuleAction} className="space-y-5" data-testid="rules-form">
          <input type="hidden" name="seasonId" value={season.id} />
          <FormField label="Max budget (coins, GK excluded)">
            <input
              name="maxBudgetCoins"
              type="number"
              min={0}
              required
              defaultValue={rule?.max_budget_coins ?? 10_000_000}
              className={inputClass}
              data-testid="rule-max-budget"
            />
          </FormField>
          <FormField label="Minimum Nigerian items in XI">
            <input
              name="minNigerianItems"
              type="number"
              min={0}
              required
              defaultValue={rule?.min_nigerian_items ?? 1}
              className={inputClass}
              data-testid="rule-min-ng"
            />
          </FormField>
          <FormField
            label="Banned item types"
            hint="Comma- or whitespace-separated. Rulebook: evolution, season_pass, objective."
          >
            <textarea
              name="bannedItemTypes"
              rows={3}
              defaultValue={(rule?.banned_item_types ?? [
                "evolution",
                "season_pass",
                "objective",
              ]).join(", ")}
              className={textareaClass}
              data-testid="rule-banned"
            />
          </FormField>
          <FormField label="Notes" hint="Optional context for future admins.">
            <textarea
              name="notes"
              rows={2}
              defaultValue={rule?.notes ?? ""}
              className={textareaClass}
            />
          </FormField>
          <PrimaryButton type="submit">Save rules</PrimaryButton>
        </form>
      ) : null}
    </div>
  );
}
