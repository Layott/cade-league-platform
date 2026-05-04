/**
 * Plan 54 — shared helpers for the 5 `next/og` social-asset routes.
 *
 * Pure-Edge: no `node:crypto`, no `next/headers`, no Node-only Supabase
 * helpers. Each export is small + composable so the route handlers stay
 * readable.
 *
 * Why a separate file? Each of the 5 OG routes duplicates the same
 * pre-flight (parse size → require session → build edge supabase →
 * gate via view-token → fetch payload). Hoisting the pre-flight into
 * a single helper means a future change (e.g. swapping the gate from
 * `view_token` to a signed-cookie scheme in Phase 2) only edits one
 * file.
 *
 * The helpers deliberately do NOT import `next/og` — that import has
 * side effects in the Edge bundle and we want unit tests to skip it.
 *
 * Spec: docs/superpowers/specs/2026-05-05-broadcast-social-media.md §6.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { parseSize, type SocialSize } from "@/lib/social-sizes";

/**
 * Build an Edge-safe service-role Supabase client. The standard
 * `getServiceRoleSupabase` helper is module-cached via a top-level
 * `let cached` ref — fine on Node, but on Edge each isolate is short-
 * lived enough that a per-request client is cheaper than tracking
 * cache freshness across cold starts.
 */
export function buildEdgeSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "social/og: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Edge-friendly view-token gate. Mirrors
 * `server/broadcast/view_token_gate.ts` but without
 * `node:crypto.timingSafeEqual` (Edge does not provide it).
 *
 * Returns `null` on success and a `Response` to short-circuit on
 * failure. Sessions with NULL `view_token` are publicly readable
 * (pre-M3 backwards-compat — same rule the Node helper applies).
 */
export async function checkViewTokenEdge(
  sb: SupabaseClient,
  req: Request,
  sessionId: string,
): Promise<Response | null> {
  const { data: row, error } = await sb
    .from("stream_sessions")
    .select("id, view_token, deleted_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (error || !row || (row as { deleted_at: string | null }).deleted_at) {
    return new Response("invalid_token", { status: 401 });
  }
  const expected =
    ((row as { view_token: string | null }).view_token as string | null) ?? null;
  if (expected === null) return null;

  const url = new URL(req.url);
  const provided =
    url.searchParams.get("t") ??
    (() => {
      const auth = req.headers.get("authorization") ?? "";
      const bearer = auth.replace(/^Bearer\s+/i, "").trim();
      return bearer.length > 0 ? bearer : null;
    })();
  if (!provided) return new Response("invalid_token", { status: 401 });

  // JS-only constant-time compare. Equal length OR same-length-with-mismatch
  // both run the same loop. Length mismatch leaks one bit (the secret length
  // is fixed per session at issuance, so this is acceptable).
  if (provided.length !== expected.length) {
    return new Response("invalid_token", { status: 401 });
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  if (diff !== 0) return new Response("invalid_token", { status: 401 });
  return null;
}

/**
 * Pre-flight bundle: parse size param, validate session param, build the
 * Supabase client, run the view-token gate. Returns either a typed
 * `Ok` ready for the route's data fetcher, or an `Err` carrying a
 * pre-formed `Response` the caller should return verbatim.
 */
export type OgPreflightOk = {
  ok: true;
  size: SocialSize;
  sessionId: string;
  sb: SupabaseClient;
  origin: string;
};
export type OgPreflightErr = {
  ok: false;
  response: Response;
};
export type OgPreflightResult = OgPreflightOk | OgPreflightErr;

export async function ogPreflight(
  req: Request,
  params: Promise<{ size: string }>,
): Promise<OgPreflightResult> {
  let size: SocialSize;
  try {
    const { size: sizeParam } = await params;
    size = parseSize(sizeParam);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "invalid size";
    return { ok: false, response: new Response(msg, { status: 400 }) };
  }

  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session");
  if (!sessionId) {
    return {
      ok: false,
      response: new Response("missing session param", { status: 400 }),
    };
  }

  let sb: SupabaseClient;
  try {
    sb = buildEdgeSupabase();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "supabase build error";
    return { ok: false, response: new Response(msg, { status: 500 }) };
  }

  const gateFail = await checkViewTokenEdge(sb, req, sessionId);
  if (gateFail) return { ok: false, response: gateFail };

  return { ok: true, size, sessionId, sb, origin: url.origin };
}

/**
 * Standard cache-control header used across the 5 OG routes:
 * 1 minute fresh on the CDN, 5 minutes stale-while-revalidate. The
 * data feed itself is `no-store`, but the OG image caches at the edge
 * so admin previews stay snappy.
 */
export const OG_CACHE_HEADER =
  "public, max-age=0, s-maxage=60, stale-while-revalidate=300";
