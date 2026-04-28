import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { enforceAuthedWrite } from "@/lib/api-rate-limit";
import { clearOverlay } from "@/server/broadcast/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/broadcast/events/:id/clear
 * Requires broadcast.trigger.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) return new NextResponse("Unauthorized", { status: 401 });

  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) return new NextResponse("Unauthorized", { status: 401 });

  const { data: rolesRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (rolesRows ?? []).map((r: { role: string }) => r.role);

  const sb = getServiceRoleSupabase();
  try {
    await requirePermAsync(sb, { userId: pub.id, roles }, "broadcast.trigger");
  } catch (err) {
    if (err instanceof PermissionError) {
      return new NextResponse("Forbidden", { status: 403 });
    }
    throw err;
  }

  const limited = await enforceAuthedWrite(pub.id);
  if (limited) return limited;

  try {
    await clearOverlay(sb, id, pub.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
