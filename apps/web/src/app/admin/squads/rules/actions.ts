"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { enforceAuthedWrite } from "@/lib/api-rate-limit";
import { upsertRule } from "@/server/squads";
import type { Actor } from "@/perms";

async function loadActor(sb: Awaited<ReturnType<typeof getServerSupabase>>): Promise<Actor> {
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("unauthenticated");
  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", user.id)
    .single();
  if (!pub) throw new Error("no public user row");
  const { data: roles } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  return {
    userId: pub.id,
    roles: (roles ?? []).map((r: { role: string }) => r.role),
  };
}

export async function saveRuleAction(formData: FormData): Promise<void> {
  const seasonId = String(formData.get("seasonId") ?? "");
  const maxBudgetCoins = Number(formData.get("maxBudgetCoins") ?? 0);
  const minNigerianItems = Number(formData.get("minNigerianItems") ?? 0);
  const bannedRaw = String(formData.get("bannedItemTypes") ?? "");
  const bannedItemTypes = bannedRaw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const notes = String(formData.get("notes") ?? "") || null;

  const sb = await getServerSupabase();
  const actor = await loadActor(sb);
  const limited = await enforceAuthedWrite(actor.userId as string);
  if (limited) throw new Error("rate_limited");
  await upsertRule(sb, actor, {
    seasonId,
    maxBudgetCoins,
    minNigerianItems,
    bannedItemTypes,
    notes,
  });
  revalidatePath("/admin/squads/rules");
}
