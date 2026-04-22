import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { listActiveInstances } from "@/server/overlays/instances";
import { checkViewToken } from "@/server/broadcast/view_token_gate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Plan 37 — GET /api/broadcast/sessions/:id/instances?template_key=[&t=<view_token>]
 *
 * Unauthenticated like /active (overlay URL is the shared secret). Plan
 * 39 M3 tightens the gate: non-null `view_token` rows require the token
 * via `?t=` or `Authorization: Bearer`. Pre-M3 rows with NULL token stay
 * publicly readable for backwards compat.
 *
 * Returns active instances ordered by slot.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sb = getServiceRoleSupabase();

  const gate = await checkViewToken(sb, req, id);
  if (!gate.ok) return gate.response;

  const templateKey = req.nextUrl.searchParams.get("template_key") ?? undefined;

  const list = await listActiveInstances(sb, id, templateKey);
  // Reshape to snake_case fields the hook expects.
  const out = list.map((i) => ({
    id: i.id,
    instance_slot: i.instanceSlot,
    template_key: i.templateKey,
    payload: i.payload,
    triggered_at: i.triggeredAt,
  }));

  return NextResponse.json(out, {
    headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" },
  });
}
