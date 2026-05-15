import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Supabase Auth code-exchange handler.
 *
 * Provider OAuth flows (Google, etc.) round-trip back through this
 * route with a `?code=<pkce>` query param. Without a handler at this
 * path Next.js renders its default 404 ("unmatched route"), which is
 * exactly what the user reported after the Google sign-in succeeded
 * provider-side but the app had no callback to close the loop.
 *
 * Behaviour:
 *   - On `?code=...` we exchange the PKCE code for a Supabase session.
 *     `getServerSupabase()` returns a `createServerClient` that writes
 *     the resulting auth cookies through Next's cookie store.
 *   - `?next=<path>` is honoured when it's a same-origin relative path
 *     (must start with `/` and not `//`). Otherwise we fall back to `/`.
 *   - On error (cancelled / invalid_grant / no code) we bounce the user
 *     to `/login?error=oauth_failed` instead of leaving them on a blank
 *     404 page.
 *
 * `dynamic = "force-dynamic"` because the response depends on a
 * runtime query string the static prerender can't anticipate.
 */
export const dynamic = "force-dynamic";

function safeNextPath(value: string | null): string {
  if (!value) return "/";
  // Reject protocol-relative + absolute URLs — those could redirect the
  // newly-authenticated user off-domain.
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");
  const nextPath = safeNextPath(url.searchParams.get("next"));

  if (oauthError) {
    const target = new URL(
      `/login?error=${encodeURIComponent(oauthError)}`,
      url.origin,
    );
    return NextResponse.redirect(target);
  }

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing_code", url.origin));
  }

  const sb = await getServerSupabase();
  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent(error.message || "oauth_exchange_failed")}`,
        url.origin,
      ),
    );
  }

  return NextResponse.redirect(new URL(nextPath, url.origin));
}
