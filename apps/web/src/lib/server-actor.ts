import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Plan 13B — thin helper mirroring the broadcast `gate()` pattern. Resolves
 * the authed viewer + their roles via the user-scoped Supabase client,
 * then returns a service-role client for the downstream work. Every
 * server action the plan 13B surface adds runs through this.
 */

export type AuthedActor = {
  sb: SupabaseClient; // service-role client
  userId: string; // public users.id
  roles: readonly string[];
};

export async function resolveActor(): Promise<AuthedActor> {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login");
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  return { sb: getServiceRoleSupabase(), userId: pub.id, roles };
}

export async function gate(action: string): Promise<AuthedActor> {
  const actor = await resolveActor();
  try {
    await requirePermAsync(
      actor.sb,
      { userId: actor.userId, roles: actor.roles },
      action,
    );
  } catch (e) {
    if (e instanceof PermissionError) {
      throw new Error(`Forbidden: missing ${action}`);
    }
    throw e;
  }
  return actor;
}
