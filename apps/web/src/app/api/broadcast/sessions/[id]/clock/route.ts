import { NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { getClock } from "@/server/overlays/match_clock";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Plan 37 — GET /api/broadcast/sessions/:id/clock
 * No auth (overlay URL is the shared secret). Returns the canonical
 * server-config clock state for the session, or null if unset.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sb = getServiceRoleSupabase();
  const state = await getClock(sb, id);
  if (!state) {
    return NextResponse.json(null, {
      headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" },
    });
  }
  return NextResponse.json(
    {
      mode: state.mode,
      seconds_remaining: state.secondsRemaining,
      set_at: state.setAt,
      label: state.label,
    },
    {
      headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" },
    },
  );
}
