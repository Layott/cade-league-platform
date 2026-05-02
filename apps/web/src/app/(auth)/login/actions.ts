"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import {
  recordLogin,
  recordLoginFailure,
  getLockoutInfo,
} from "@/server/auth/sessions";
import { authLimiter } from "@/lib/rate-limit";

const GENERIC_AUTH_ERROR = "invalid_credentials";

/**
 * Login lockout (Plan 39 M2 -> Bug 11 fix 2026-05-01).
 *
 * Threshold semantics: `count > LOCKOUT_THRESHOLD` (NOT `>=`). The 5th
 * failure is a warning state, the 6th attempt is what actually locks the
 * account. This avoids the off-by-one perception users hit in the field
 * (player typed correct creds, but a typo on the 5th attempt locked them
 * even though the 5th felt like the "still allowed" attempt).
 *
 * Window 5 min (300_000 ms) -- was 1 min on 2026-04-28 but that was too
 * aggressive given the small known roster. Restored to 5 min to give
 * legitimate users typo-recovery headroom while still slowing down
 * credential-stuffing.
 *
 * Lockout state lives in `auth_events` (login_failed rows). All helpers
 * - recording, probing, clearing - moved to `@/server/auth/sessions`
 * so the admin unlock action can share the exact same logic and the
 * email is normalized once at the boundary.
 */

// Role-based default landing when the login form has no explicit `next`.
// Staff roles go to /admin; players to /player; anyone else (viewer /
// design / technical / team_manager / coach / no-role) to /profile.
function defaultLandingForRoles(roles: readonly string[]): string {
  const STAFF = new Set(["admin", "loc", "idc", "referee", "production", "moderator"]);
  if (roles.some((r) => STAFF.has(r))) return "/admin";
  if (roles.includes("player")) return "/player";
  return "/profile";
}

/**
 * Open-redirect guard for the post-login `?next=` query param.
 * Accept ONLY same-origin paths: must start with a single "/", must not
 * begin with "//" or "/\\" (protocol-relative URL), must not contain
 * scheme delimiters, must not embed CR/LF (header injection).
 */
function isSafeNextPath(value: string): boolean {
  if (!value) return false;
  if (value.length > 512) return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//") || value.startsWith("/\\")) return false;
  if (/[\r\n\t]/.test(value)) return false;
  if (/^\/+[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  return true;
}

/**
 * Build the lockout error redirect URL with a remaining-time hint so the
 * page can render a humane "Try again in N minutes" copy. `error` is the
 * machine-readable error code (login/page.tsx maps it to a user-facing
 * string); `minutes` is appended as a query param for templating.
 */
function lockoutRedirectUrl(msRemaining: number): string {
  const minutes = Math.max(1, Math.ceil(msRemaining / 60_000));
  return `/login?error=account_locked&minutes=${minutes}`;
}

export async function login(formData: FormData) {
  // Lowercase + trim email at the SINGLE entry point so every downstream
  // boundary (Supabase auth lookup, recordLoginFailure key, getLockoutInfo
  // probe, rate-limit key) sees the identical normalized value. The bug
  // 11 root cause "uppercase email triggers lockout but lowercase key
  // misses it" is impossible after this normalization.
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const nextParam = String(formData.get("next") ?? "");

  const sb = await getServerSupabase();
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0";
  const svc = getServiceRoleSupabase();

  // Rate-limit gate (Redis-backed via Upstash). Two parallel keys so an
  // attacker that rotates IPs against one account still hits the email
  // budget, AND so a shared-IP party can't be locked out by one bad
  // actor sharing their NAT. Both must succeed; whichever exhausts
  // first triggers the cool-down. Distinct error code (rate_limited)
  // so the login page renders "slow down" copy instead of "account
  // locked, contact admin" copy.
  if (email.length > 0) {
    const ipEmailRes = await authLimiter.limit(`${ip}:${email}`);
    const emailRes = await authLimiter.limit(`email:${email}`);
    if (!ipEmailRes.success || !emailRes.success) {
      try {
        await recordLoginFailure(svc, email, "rate_limited");
      } catch {
        // ignore -- best-effort forensic log
      }
      redirect(`/login?error=rate_limited`);
    }
  }

  // DB-backed defense-in-depth (works when Redis is unreachable). Single
  // round-trip surfaces both "is locked" + "ms remaining" so we can pass
  // the user a concrete countdown.
  const lockInfo = await getLockoutInfo(svc, email);
  if (lockInfo.locked) {
    redirect(lockoutRedirectUrl(lockInfo.msRemaining));
  }

  const { error, data } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    await recordLoginFailure(svc, email, error?.message ?? "unknown");
    // Re-check after recording -- if THIS attempt was the one that
    // crossed the threshold, surface the lockout copy directly so the
    // user doesn't keep retrying and burn through fresh attempts.
    const after = await getLockoutInfo(svc, email);
    if (after.locked) {
      redirect(lockoutRedirectUrl(after.msRemaining));
    }
    redirect(`/login?error=${GENERIC_AUTH_ERROR}`);
  }

  // Post-auth bookkeeping reads PII columns (email, last_login_at)
  // that anon + authenticated don't hold SELECT grants on after Plan 39
  // C2. Elevate to service-role for the lookup + recordLogin.
  const { data: pub } = await svc
    .from("users")
    .select("id")
    .eq("supabase_auth_id", data.user.id)
    .single();
  if (!pub) {
    redirect(`/login?error=unknown_error`);
  }

  await recordLogin(svc, {
    publicUserId: pub.id,
    ipAddress: ip,
    userAgent: h.get("user-agent") ?? "",
    acceptLanguage: h.get("accept-language") ?? "",
  });

  if (nextParam && isSafeNextPath(nextParam)) {
    redirect(nextParam);
  }
  const { data: roleRows } = await svc
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  redirect(defaultLandingForRoles(roles));
}
