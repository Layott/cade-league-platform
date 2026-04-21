import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { previewSuspensionVoids } from "@/server/punishments/preview";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/punishments/preview-voids
 * Body: { playerId: string; effectiveFrom: string; effectiveUntil: string }
 * Requires punishments.issue. Read-only — returns the list of scheduled
 * matches that would be voided by a ban with the given window.
 */
export async function POST(req: NextRequest) {
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
    await requirePermAsync(sb, { userId: pub.id, roles }, "punishments.issue");
  } catch (err) {
    if (err instanceof PermissionError) {
      return new NextResponse("Forbidden", { status: 403 });
    }
    throw err;
  }

  const body = (await req.json().catch(() => null)) as {
    playerId?: string;
    effectiveFrom?: string;
    effectiveUntil?: string;
  } | null;
  if (!body?.playerId || !body.effectiveFrom || !body.effectiveUntil) {
    return NextResponse.json(
      { error: "playerId + effectiveFrom + effectiveUntil required" },
      { status: 400 },
    );
  }

  try {
    const matches = await previewSuspensionVoids(
      sb,
      body.playerId,
      body.effectiveFrom,
      body.effectiveUntil,
    );
    return NextResponse.json({ matches }, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
