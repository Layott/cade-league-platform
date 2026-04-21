import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import {
  listActiveOverlays,
  getActiveForTemplate,
} from "@/server/broadcast/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/broadcast/sessions/:id/active[?template_key=scorebar]
 *
 * NO AUTH. Overlay pages run in headless browser sources (OBS, vMix,
 * Streamlabs, etc.) and the URL itself is the shared secret.
 * Service-role client bypasses RLS.
 * Response payload is only the overlay_events fields — no PII leakage.
 *
 * If `template_key` is provided, returns a single row or null (the most
 * recent non-cleared event for that template in that session). Used by
 * each /overlay/<key>/page.tsx to hydrate on mount.
 *
 * Otherwise returns the full active overlay list (used by the admin
 * control panel's polling fallback).
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
