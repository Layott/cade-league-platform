import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import {
  listActiveOverlays,
  getActiveForTemplate,
} from "@/server/broadcast/events";
import { checkViewToken } from "@/server/broadcast/view_token_gate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/broadcast/sessions/:id/active[?template_key=scorebar][&t=<view_token>]
 *
 * Intentionally unauthenticated — overlay pages run in headless browser
 * sources (OBS, vMix, Streamlabs, Ecamm, XSplit, Restream). A cookie gate
 * would force the operator to sign in from inside each browser source,
 * which does not scale across rigs.
 *
 * Plan 39 M3 threat model:
 *   Session UUIDs leak through admin log rows, CDN access logs, and
 *   accidental operator tab-URL shares. Plan 38 audit flagged this route
 *   because any UUID-sniffer could then poll /active and learn what's
 *   on-air in real time. Plan 39 M3 adds a per-session `view_token` which
 *   must accompany the UUID via `?t=<token>` or
 *   `Authorization: Bearer <token>`. Mismatch => 401. See
 *   `server/broadcast/view_token_gate.ts` for the shared helper.
 *
 * Backwards compat:
 *   Historical sessions minted before M3 carry `view_token IS NULL`.
 *   Those remain publicly readable (ids already leaked through audit
 *   logs). Only post-M3 sessions enforce the token.
 *
 * Service-role client bypasses RLS. Response payload is only overlay
 * event fields — no PII.
 *
 * `Cache-Control: no-store` keeps browser sources from pinning stale
 * data after a redeploy (spec §10 risk 2).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sb = getServiceRoleSupabase();

  const gate = await checkViewToken(sb, req, id);
  if (!gate.ok) return gate.response;

  const templateKey = req.nextUrl.searchParams.get("template_key");

  let body: unknown;
  if (templateKey) {
    body = await getActiveForTemplate(sb, id, templateKey);
  } else {
    body = await listActiveOverlays(sb, id);
  }

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "no-store, max-age=0, must-revalidate",
    },
  });
}
