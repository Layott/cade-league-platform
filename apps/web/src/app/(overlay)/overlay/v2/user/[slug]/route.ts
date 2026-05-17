import { type NextRequest } from "next/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { checkViewToken } from "@/server/broadcast/view_token_gate";
import { enforcePublicRead } from "@/lib/api-rate-limit";
import { compileDesignToHtml } from "@/server/overlays/builder/compiler";
import { getDesign } from "@/server/overlays/builder/designs";
import { verifyPreviewToken } from "@/server/overlays/builder/preview-token";
import { requirePermAsync, PermissionError } from "@/lib/perms-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Wave 1A — runtime route for user-authored overlays.
 *
 * Returns a raw HTML document (NOT a React page). OBS browser sources
 * point here directly with a `?sessionId=<uuid>&t=<view_token>` query
 * string for live data binding; admins can preview drafts via
 * `?previewToken=<jwt>`.
 *
 * Auth + gating:
 *   - Published design + no sessionId → serve HTML (OBS standalone preview).
 *     Bootstrap's __OVERLAY_FEEDS__ registry resolves to null fetchPaths
 *     and the overlay paints binding placeholders only.
 *   - Published design + sessionId → checkViewToken gate via ?t=<token>;
 *     returns 401 on mismatch.
 *   - Draft design + no previewToken → 404 (do not leak draft existence).
 *   - Draft design + valid signed previewToken → serve HTML.
 *     Preview token also requires overlay.design.manage permission (re-checked
 *     live so revoked roles cannot reuse a stale token until expiry).
 *
 * Caching: `Cache-Control: no-store` — design contents change on every
 * admin save and the HTML is per-session anyway (`${sessionId}`
 * substitution). Realtime data hydration happens in the browser via
 * the injected bootstrap.
 *
 * CSP: locks all origins by default-src; allows self+inline script/style;
 * supabase.co for img-src + connect-src; frame-ancestors * so OBS/vMix
 * can embed without X-Frame-Options interference.
 */

const CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "frame-ancestors *",
].join("; ");

// Slug validation — must be lowercase alphanumeric + hyphens only.
const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": CSP,
    },
  });
}

function notFound(): Response {
  return new Response("not found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "invalid_token" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  // Rate-limit IP-keyed reads before doing any DB work.
  const limited = await enforcePublicRead(req);
  if (limited) return limited;

  const { slug } = await params;
  if (!slug || !SLUG_RE.test(slug)) return notFound();

  const searchParams = req.nextUrl.searchParams;
  const demo = searchParams.get("demo") === "1";
  const sessionId = searchParams.get("sessionId") ?? "";
  const previewToken = searchParams.get("previewToken");

  const sb = getServiceRoleSupabase();
  const design = await getDesign(sb, slug);

  // getDesign already filters deleted_at IS NULL, but guard explicitly.
  if (!design) return notFound();

  // --- Draft access: requires a valid admin preview token ---
  if (design.status !== "published") {
    if (!previewToken) return notFound();

    const verified = await verifyPreviewToken(previewToken, slug);
    if (!verified.ok) return notFound();

    // Re-check perm live so revoked roles can't ride out stale tokens.
    try {
      await requirePermAsync(sb, verified.actor, "overlay.design.manage");
    } catch (e) {
      if (e instanceof PermissionError) return notFound();
      throw e;
    }
  }

  // --- Session view-token gate (live OBS browser source mode) ---
  // Only runs when caller supplied a sessionId. Standalone / demo
  // renders skip this so admins can preview without an active session.
  if (sessionId) {
    const gate = await checkViewToken(sb, req, sessionId);
    if (!gate.ok) return unauthorized();
  }

  // Compile design to §14-contract HTML.
  let html = compileDesignToHtml(design, 0, { demo });

  // Substitute ${sessionId} placeholders that the compiler emits in the
  // __OVERLAY_FEEDS__ registry with the actual session id. When absent
  // (standalone preview) the bootstrap treats an empty fetchPath as
  // event-driven-only and skips the initial fetch.
  html = html.replace(/\$\{sessionId\}/g, sessionId);

  return htmlResponse(html);
}
