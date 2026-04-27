import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { getActiveSession } from "@/server/broadcast/active_session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Constant-time secret comparison. Falls through to `false` on any
 * length mismatch (the call to `timingSafeEqual` would throw otherwise).
 */
function secretsMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * GET /api/broadcast/active-session
 *
 * Ambient-session lookup. Polled every 30s by OBS / vMix browser
 * sources so they can re-subscribe to a new Realtime channel when one
 * session ends + a new one starts mid-stream.
 *
 * **viewToken handling (Plan 39 M3 + 2026-04-28 hardening):**
 * The per-session `view_token` is the gate that keeps anonymous callers
 * from pulling a session's overlay feeds. Returning the token from this
 * endpoint without a credential previously nullified the gate. The
 * route now requires the ambient secret (`BROADCAST_AMBIENT_SECRET`
 * env var, baked into the OBS browser-source URL exactly once) before
 * surfacing `viewToken`. Without the secret, only IDs are returned —
 * IDs alone don't unlock the gated session feeds.
 *
 * The secret is accepted as either:
 *   - `?secret=<value>` query param  (OBS-friendly, no header support)
 *   - `X-Ambient-Secret: <value>` header (curl / programmatic)
 *
 * `Cache-Control: no-store` so polls always see the latest state.
 */
export async function GET(req: NextRequest) {
  const sb = getServiceRoleSupabase();
  const info = await getActiveSession(sb);

  const expected = process.env.BROADCAST_AMBIENT_SECRET ?? "";
  const provided =
    req.nextUrl.searchParams.get("secret") ??
    req.headers.get("x-ambient-secret") ??
    "";
  const allowed = expected.length > 0 && secretsMatch(provided, expected);

  return NextResponse.json(
    {
      sessionId: info?.sessionId ?? null,
      matchDayId: info?.matchDayId ?? null,
      seasonId: info?.seasonId ?? null,
      viewToken: allowed ? info?.viewToken ?? null : null,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0, must-revalidate",
      },
    },
  );
}
