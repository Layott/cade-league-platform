import { NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { getActiveSession } from "@/server/broadcast/active_session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/broadcast/active-session
 *
 * Ambient-session lookup (2026-04-26).
 *
 * Returns the currently live `stream_sessions` row, or nulls if no
 * session is active. Polled every 30s by `OverlayDataInjector` so live
 * (OBS / vMix) browser sources auto-resubscribe to the new Realtime
 * channel when one session ends + a new one starts mid-stream — without
 * the operator having to re-paste URLs.
 *
 * Public read — no auth gate. The browser sources running this poll have
 * no cookies, so any auth check would force every overlay tab to log in.
 * The endpoint only leaks `{sessionId, matchDayId, seasonId}` triples,
 * which were already public via overlay traffic. PII never traverses
 * this path.
 *
 * `Cache-Control: no-store` so polls always see the latest state — a 30s
 * cache would make session transitions look "stuck" to operators.
 */
export async function GET() {
  const sb = getServiceRoleSupabase();
  const info = await getActiveSession(sb);
  return NextResponse.json(
    {
      sessionId: info?.sessionId ?? null,
      matchDayId: info?.matchDayId ?? null,
      seasonId: info?.seasonId ?? null,
      // 2026-04-26 — surface viewToken so live OBS / vMix browser sources
      // pointed at the bare ambient URL can sign their per-session
      // initial-fetch calls (`/api/broadcast/sessions/<id>/<feed>?t=...`).
      // Without this, the `view_token` gate returns 401 + the iframe
      // never receives the seed payload, so static demo data leaks
      // through (wrong match-day label, wrong matches, no live update).
      viewToken: info?.viewToken ?? null,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0, must-revalidate",
      },
    },
  );
}
