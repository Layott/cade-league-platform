import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { enforceAuthedWrite } from "@/lib/api-rate-limit";
import { searchCards, searchCardsInputSchema } from "@/server/fcdb/search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/fcdb/search
 * Body: { q: string (≥2 chars), position?: string }
 *
 * Plan 30 — typeahead endpoint for the Futbin-style squad picker. Returns up
 * to 10 cards ranked by match quality.
 *
 * Auth gate: any authenticated user with a role ∈ { player, admin, loc,
 * referee, moderator }. We don't use a dedicated perm string for this
 * read-only catalogue search — `fc26_players` is a public-catalogue table
 * with no PII, and the gate is purely spam-prevention.
 */

const ALLOWED_ROLES = new Set([
  "player",
  "admin",
  "loc",
  "referee",
  "moderator",
]);

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
  if (!roles.some((r) => ALLOWED_ROLES.has(r))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const limited = await enforceAuthedWrite(pub.id);
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as {
    q?: string;
    position?: string;
    limit?: number;
  } | null;

  const parsed = searchCardsInputSchema.safeParse({
    q: body?.q ?? "",
    position: body?.position,
    limit: body?.limit ?? 10,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid input" },
      { status: 400 },
    );
  }

  // Service-role for the actual read — `fc26_players` has no RLS so this is
  // equivalent to the user client, but we keep the pattern consistent with
  // the rest of the admin API surface.
  const sb = getServiceRoleSupabase();
  try {
    const results = await searchCards(sb, parsed.data);
    return NextResponse.json({ results }, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
