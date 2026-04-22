import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Plan 39 M3 — shared view_token gate for the unauthenticated per-session
 * overlay read endpoints.
 *
 * Used by:
 *   - GET /api/broadcast/sessions/:id/active
 *   - GET /api/broadcast/sessions/:id/instances
 *   - GET /api/broadcast/sessions/:id/clock
 *
 * Behaviour:
 *   - Unknown / soft-deleted session id     -> 401 (no existence leak).
 *   - Session has non-null `view_token` and
 *     caller did not provide matching token -> 401.
 *   - Session has NULL `view_token`
 *     (pre-M3 historical row)               -> allowed (backwards compat).
 *   - Token match                           -> returns `{ ok: true }`.
 *
 * Callers should short-circuit on `.response` being non-null and otherwise
 * continue handling the request.
 */

export type ViewTokenGateResult =
  | { ok: true; response: null }
  | { ok: false; response: NextResponse };

export async function checkViewToken(
  sb: SupabaseClient,
  req: NextRequest | Request,
  sessionId: string,
): Promise<ViewTokenGateResult> {
  const { data: row, error } = await sb
    .from("stream_sessions")
    .select("id, view_token, deleted_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (error || !row || row.deleted_at) {
    return {
      ok: false,
      response: NextResponse.json({ error: "invalid_token" }, { status: 401 }),
    };
  }

  const expected = (row.view_token as string | null) ?? null;
  if (expected === null) {
    // Pre-M3 historical row — publicly readable by design.
    return { ok: true, response: null };
  }

  const provided = extractProvidedToken(req);
  if (provided !== expected) {
    return {
      ok: false,
      response: NextResponse.json({ error: "invalid_token" }, { status: 401 }),
    };
  }
  return { ok: true, response: null };
}

function extractProvidedToken(req: NextRequest | Request): string | null {
  // ?t=<token>
  let queryToken: string | null = null;
  try {
    const url = new URL(req.url);
    queryToken = url.searchParams.get("t");
  } catch {
    queryToken = null;
  }
  if (queryToken) return queryToken;

  // Authorization: Bearer <token>
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  return bearer.length > 0 ? bearer : null;
}
