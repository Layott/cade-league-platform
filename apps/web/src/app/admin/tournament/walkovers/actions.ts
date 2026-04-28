"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { hasPermAsync, PermissionError } from "@/lib/perms-db";
import { enforceAuthedWrite } from "@/lib/api-rate-limit";
import {
  confirmRefPendingWalkover,
  triggerAdminWalkover,
} from "@/server/walkovers";
import { getActiveSeason } from "@/server/seasons";
import { publishStandingsChanged } from "@/server/standings/realtime";

/**
 * Plan 51 — server actions for the Walkovers tab.
 *
 * `confirmPendingWalkoverAction` flips a ref-marked pending walkover to
 * confirmed (admin only — refs shouldn't confirm their own marks).
 * `triggerWalkoverAction` writes a brand-new admin walkover row.
 *
 * Both fire `publishStandingsChanged` belt-and-braces (the DB trigger also
 * publishes), then revalidate the four tabs that consume walkover state.
 */

async function resolveActor() {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/admin/tournament/walkovers");

  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/admin/tournament/walkovers");

  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  return {
    userId: pub.id,
    roles,
    svc: getServiceRoleSupabase(),
  };
}

function isReferee(roles: string[]): boolean {
  return roles.includes("referee") && !roles.includes("admin");
}

const matchIdSchema = z.string().uuid();

export async function confirmPendingWalkoverAction(
  matchId: string,
): Promise<{ ok: boolean; error?: string }> {
  let parsed: string;
  try {
    parsed = matchIdSchema.parse(matchId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid id" };
  }

  const ctx = await resolveActor();
  try {
    const ok = await hasPermAsync(
      ctx.svc,
      { userId: ctx.userId, roles: ctx.roles },
      "tournament.walkover_confirm",
    );
    if (!ok) throw new PermissionError("missing tournament.walkover_confirm");
    // Refs can mark-pending but not confirm.
    if (isReferee(ctx.roles)) {
      throw new PermissionError(
        "referees can only mark pending walkovers; admin must confirm",
      );
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Forbidden",
    };
  }

  const limited = await enforceAuthedWrite(ctx.userId);
  if (limited) return { ok: false, error: "rate_limited" };

  try {
    await confirmRefPendingWalkover(parsed, ctx.svc, ctx.userId);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Confirm failed",
    };
  }

  try {
    const season = await getActiveSeason(ctx.svc);
    if (season) await publishStandingsChanged(ctx.svc, season.id);
  } catch {
    /* trigger handles it */
  }

  revalidatePath("/admin/tournament/walkovers");
  revalidatePath("/admin/tournament/standings");
  revalidatePath("/admin/tournament/fixtures");
  return { ok: true };
}

const triggerSchema = z.object({
  matchId: z.string().uuid(),
  winnerPlayerId: z.string().uuid(),
});

export async function triggerWalkoverAction(
  input: z.infer<typeof triggerSchema>,
): Promise<{ ok: boolean; error?: string }> {
  let parsed: z.infer<typeof triggerSchema>;
  try {
    parsed = triggerSchema.parse(input);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid input" };
  }

  const ctx = await resolveActor();
  try {
    const ok = await hasPermAsync(
      ctx.svc,
      { userId: ctx.userId, roles: ctx.roles },
      "tournament.walkover_confirm",
    );
    if (!ok) throw new PermissionError("missing tournament.walkover_confirm");
    if (isReferee(ctx.roles)) {
      throw new PermissionError(
        "referees cannot trigger walkovers directly — mark pending instead",
      );
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Forbidden",
    };
  }

  const limited = await enforceAuthedWrite(ctx.userId);
  if (limited) return { ok: false, error: "rate_limited" };

  try {
    await triggerAdminWalkover(
      parsed.matchId,
      parsed.winnerPlayerId,
      ctx.svc,
      ctx.userId,
    );
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Trigger failed",
    };
  }

  try {
    const season = await getActiveSeason(ctx.svc);
    if (season) await publishStandingsChanged(ctx.svc, season.id);
  } catch {
    /* trigger handles it */
  }

  revalidatePath("/admin/tournament/walkovers");
  revalidatePath("/admin/tournament/standings");
  revalidatePath("/admin/tournament/fixtures");
  return { ok: true };
}
