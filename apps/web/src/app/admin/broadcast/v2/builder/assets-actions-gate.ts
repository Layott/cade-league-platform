import "server-only";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { enforceAuthedWrite } from "@/lib/api-rate-limit";

/**
 * Wave 2A — shared gate for builder asset-upload actions.
 *
 * Same logic as the Wave 1A `gate()` inside actions.ts, lifted to a
 * sibling module so both action files share one implementation.
 *
 * Per CLAUDE.md §10 this file is NOT marked 'use server' because it
 * exports a sync `gate()` factory that is invoked by 'use server'
 * action files. It IS marked 'server-only' so the bundler refuses
 * to ship it to the client.
 */

export type Actor = { userId: string; roles: readonly string[] };

export type GateResult = {
  sb: ReturnType<typeof getServiceRoleSupabase>;
  actor: Actor;
};

export async function gate(): Promise<GateResult> {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth?.user) redirect("/login");
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
  const roles = ((roleRows ?? []) as { role: string }[]).map((r) => r.role);
  const sb = getServiceRoleSupabase();
  try {
    await requirePermAsync(sb, { userId: pub.id, roles }, "overlay.design.manage");
  } catch (e) {
    if (e instanceof PermissionError) {
      throw new Error("Forbidden: missing overlay.design.manage");
    }
    throw e;
  }
  const limited = await enforceAuthedWrite(pub.id);
  if (limited) throw new Error("rate_limited");
  return { sb, actor: { userId: pub.id, roles } };
}
