"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { hasPermAsync, PermissionError } from "@/lib/perms-db";
import { getActiveSeason } from "@/server/seasons";
import { publishStandingsChanged } from "@/server/standings/realtime";

/**
 * Plan 51 — server action backing the Tiebreaker Config save button.
 *
 * Validates the order array against the seven supported keys, dedupes
 * while preserving order, persists, and publishes standings.changed so the
 * LiveLeaderboard re-fetches with the new order applied.
 */

const ALLOWED = [
  "totalPts",
  "gd",
  "gf",
  "wins",
  "losses",
  "played",
  "name",
] as const;

const orderSchema = z
  .array(z.enum(ALLOWED))
  .min(1, "order must contain at least one key")
  .max(10, "order must have at most 10 keys");

export async function saveTiebreakerOrderAction(
  order: string[],
): Promise<{ ok: boolean; error?: string }> {
  let parsed: z.infer<typeof orderSchema>;
  try {
    parsed = orderSchema.parse(order);
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof z.ZodError
          ? e.issues[0]?.message ?? "Invalid order"
          : "Invalid order",
    };
  }

  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/admin/tournament/tiebreaker-config");

  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/admin/tournament/tiebreaker-config");

  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  const svc = getServiceRoleSupabase();
  try {
    const ok = await hasPermAsync(
      svc,
      { userId: pub.id, roles },
      "tournament.tiebreaker_config",
    );
    if (!ok) throw new PermissionError("missing tournament.tiebreaker_config");
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Forbidden",
    };
  }

  // Dedupe while preserving order so JSONB stays clean.
  const seen = new Set<string>();
  const dedup: string[] = [];
  for (const k of parsed) {
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(k);
  }

  const season = await getActiveSeason(svc);
  if (!season) {
    return { ok: false, error: "No active season" };
  }

  const { error } = await svc
    .from("seasons")
    .update({ tiebreaker_order: dedup })
    .eq("id", season.id);
  if (error) {
    return { ok: false, error: error.message };
  }

  try {
    await publishStandingsChanged(svc, season.id);
  } catch {
    /* fire-and-forget */
  }

  revalidatePath("/admin/tournament/tiebreaker-config");
  revalidatePath("/admin/tournament/standings");
  return { ok: true };
}
