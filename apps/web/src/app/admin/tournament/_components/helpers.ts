import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import {
  hasPermAsync,
  requirePermAsync,
  PermissionError,
} from "@/lib/perms-db";
import type { Actor } from "@/perms";

/**
 * Plan 51 — shared resolver for /admin/tournament tab pages. Resolves the
 * authenticated actor + roles, builds a service-role client, and gates the
 * page on the supplied perm. Throws a generic Forbidden Error rather than
 * letting the bare PermissionError leak; layout's area gate has already
 * confirmed `tournament.read` so this is per-tab fine-grain.
 */
export async function resolveTabGate(perm: string): Promise<{
  actor: Actor;
  svc: ReturnType<typeof getServiceRoleSupabase>;
}> {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/admin/tournament");

  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/admin/tournament");

  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  const actor: Actor = { userId: pub.id, roles };

  const svc = getServiceRoleSupabase();
  try {
    await requirePermAsync(svc, actor, perm);
  } catch (e) {
    if (e instanceof PermissionError) {
      throw new Error(`Forbidden: ${perm}`);
    }
    throw e;
  }
  return { actor, svc };
}

export async function viewerCan(
  svc: ReturnType<typeof getServiceRoleSupabase>,
  actor: Actor,
  perm: string,
): Promise<boolean> {
  return hasPermAsync(svc, actor, perm);
}
