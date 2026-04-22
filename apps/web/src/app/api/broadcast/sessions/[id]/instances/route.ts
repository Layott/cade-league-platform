import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { listActiveInstances } from "@/server/overlays/instances";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Plan 37 — GET /api/broadcast/sessions/:id/instances?template_key=
 * No auth (consistent with the existing `/active` endpoint — overlay
 * URL is the shared secret). Returns active instances ordered by slot.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sb = getServiceRoleSupabase();
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
