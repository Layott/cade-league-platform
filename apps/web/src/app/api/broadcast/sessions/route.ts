import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { startSession } from "@/server/broadcast/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/broadcast/sessions
 * Body: { matchDayId: string; tag?: string; notes?: string }
 * Requires broadcast.manage.
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
    await requirePermAsync(sb, { userId: pub.id, roles }, "broadcast.manage");
  } catch (err) {
    if (err instanceof PermissionError) {
      return new NextResponse("Forbidden", { status: 403 });
    }
    throw err;
  }

  const body = (await req.json().catch(() => null)) as {
    matchDayId?: string;
    tag?: string;
    notes?: string;
  } | null;
  if (!body || !body.matchDayId) {
    return NextResponse.json(
      { error: "matchDayId required" },
      { status: 400 },
    );
  }

  try {
    const out = await startSession(sb, {
      matchDayId: body.matchDayId,
      userId: pub.id,
      tag: body.tag,
      notes: body.notes,
    });
    return NextResponse.json({ id: out.id }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
