import { NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { getClock } from "@/server/overlays/match_clock";
import { checkViewToken } from "@/server/broadcast/view_token_gate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Plan 37 — GET /api/broadcast/sessions/:id/clock[?t=<view_token>]
 *
 * Unauthenticated like /active (overlay URL is the shared secret). Plan
 * 39 M3 tightens the gate: non-null `view_token` rows require the token
 * via `?t=` or `Authorization: Bearer`. Pre-M3 rows with NULL token stay
 * publicly readable for backwards compat.
 *
 * Returns the canonical server-config clock state for the session, or
 * null if unset.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sb = getServiceRoleSupabase();

  const gate = await checkViewToken(sb, req, id);
  if (!gate.ok) return gate.response;

  // Plan 48.1 — per-instance clocks. `?instance=<key>` or `?slot=<key>`
  // addresses a specific per-slot clock. Defaults to primary.
  const url = new URL(req.url);
  const instanceKey = (url.searchParams.get("instance") ?? url.searchParams.get("slot") ?? "primary").trim() || "primary";
  const state = await getClock(sb, id, instanceKey);
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
