import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import {
  requirePermAsync,
  PermissionError,
} from "@/lib/perms-db";

/**
 * Plan 44 — shared auth + perm gate for /api/youtube/* routes.
 *
 * Resolves the authenticated user, loads their roles, and checks the
 * requested permission (default `broadcast.match_control`). On failure
 * returns a NextResponse caller can `return` directly. On success returns
 * a context object.
 */

export type AuthCtx = {
  sb: ReturnType<typeof getServiceRoleSupabase>;
  publicUserId: string;
  roles: string[];
};

export async function gateYoutubeRequest(
  perm: string = "broadcast.match_control",
): Promise<{ ok: true; ctx: AuthCtx } | { ok: false; res: NextResponse }> {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) {
    return { ok: false, res: new NextResponse("Unauthorized", { status: 401 }) };
  }
  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) {
    return { ok: false, res: new NextResponse("Unauthorized", { status: 401 }) };
  }
  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  const sb = getServiceRoleSupabase();
  try {
    await requirePermAsync(sb, { userId: pub.id, roles }, perm);
  } catch (err) {
    if (err instanceof PermissionError) {
      return { ok: false, res: new NextResponse("Forbidden", { status: 403 }) };
    }
    throw err;
  }
  return {
    ok: true,
    ctx: { sb, publicUserId: pub.id, roles },
  };
}
