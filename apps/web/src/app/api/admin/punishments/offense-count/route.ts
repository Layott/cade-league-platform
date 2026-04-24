import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";
import { countPriorOffenses } from "@/server/punishments";
import { pickLadderRung } from "@/server/punishments/ladder";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const INCIDENT_TYPES = [
  "late_arrival",
  "absent",
  "forfeit",
  "equipment",
  "social_media",
  "unauthorized_access",
  "betting",
  "match_fixing",
  "dress_code",
  "other",
] as const;
type IncidentType = (typeof INCIDENT_TYPES)[number];

/**
 * POST /api/admin/punishments/offense-count
 * Body: { playerId: string; incidentType: IncidentType }
 *
 * Returns the prior-offense count + the auto-ladder rung that applies to
 * the NEXT offense (i.e. `count + 1`). The client-side PunishmentComposer
 * uses this to pre-fill sanction + magnitude + surface an inline escalation
 * notice.
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
    await requirePermAsync(
      sb,
      { userId: pub.id, roles },
      "punishments.issue",
    );
  } catch (err) {
    if (err instanceof PermissionError) {
      return new NextResponse("Forbidden", { status: 403 });
    }
    throw err;
  }

  const body = (await req.json().catch(() => null)) as {
    playerId?: string;
    incidentType?: string;
  } | null;
  if (!body?.playerId || !body.incidentType) {
    return NextResponse.json(
      { error: "playerId + incidentType required" },
      { status: 400 },
    );
  }
  if (!INCIDENT_TYPES.includes(body.incidentType as IncidentType)) {
    return NextResponse.json(
      { error: "invalid incidentType" },
      { status: 400 },
    );
  }

  try {
    const prior = await countPriorOffenses(
      sb,
      body.playerId,
      body.incidentType as IncidentType,
    );
    const offenseNumber = prior + 1;
    const rung = pickLadderRung(
      body.incidentType as IncidentType,
      offenseNumber,
    );
    return NextResponse.json(
      {
        priorOffenseCount: prior,
        offenseNumber,
        rung,
      },
      { status: 200 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }
}
