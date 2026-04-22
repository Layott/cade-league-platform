"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { recordLogin } from "@/server/auth/sessions";

const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_THRESHOLD = 5;
const GENERIC_AUTH_ERROR = "Invalid email or password";

/**
 * Plan 39 (M2) — failed-login lockout.
 *
 * If the user identified by `email` already has ≥5 `login_failed` rows in
 * the last 15 minutes, deny the attempt before calling Supabase Auth.
 * Read goes via the service-role client so we can scan auth_events
 * regardless of RLS posture (Plan 39 C3 enables RLS on the table).
 */
async function isLockedOut(email: string): Promise<boolean> {
  const svc = getServiceRoleSupabase();
  const { data: pub } = await svc
    .from("users")
    .select("id")
    .eq("email", email)
    .is("deleted_at", null)
    .maybeSingle();
  if (!pub?.id) return false;

  const since = new Date(Date.now() - LOCKOUT_WINDOW_MS).toISOString();
  const { count } = await svc
    .from("auth_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", pub.id)
    .eq("event_type", "login_failed")
    .gte("created_at", since);
  return (count ?? 0) >= LOCKOUT_THRESHOLD;
}

async function recordFailure(
  sb: Awaited<ReturnType<typeof getServerSupabase>>,
  email: string,
  reason: string,
): Promise<void> {
  // Resolve user_id (if any) so the lockout counter has a key. Failed
  // attempts against unknown emails still get recorded (user_id null) for
  // forensics — they just can't trigger the lockout path.
  const svc = getServiceRoleSupabase();
  const { data: pub } = await svc
    .from("users")
    .select("id")
    .eq("email", email)
    .is("deleted_at", null)
    .maybeSingle();
  await sb.from("auth_events").insert({
    user_id: pub?.id ?? null,
    event_type: "login_failed",
    metadata: { email, reason },
  });
}

// Role-based default landing when the login form has no explicit `next`.
// Staff roles go to /admin; players to /player; anyone else (viewer /
// design / technical / team_manager / coach / no-role) to /profile.
function defaultLandingForRoles(roles: readonly string[]): string {
  const STAFF = new Set(["admin", "loc", "idc", "referee", "production", "moderator"]);
  if (roles.some((r) => STAFF.has(r))) return "/admin";
  if (roles.includes("player")) return "/player";
  return "/profile";
}

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const nextParam = String(formData.get("next") ?? "");

  const sb = await getServerSupabase();

  if (await isLockedOut(email)) {
    redirect(
      `/login?error=${encodeURIComponent(
        "Too many failed attempts. Try again in 15 minutes.",
      )}`,
    );
  }

  const { error, data } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    await recordFailure(sb, email, error?.message ?? "unknown");
    redirect(`/login?error=${encodeURIComponent(GENERIC_AUTH_ERROR)}`);
  }

  // Post-auth bookkeeping reads PII columns (email, last_login_at)
  // that anon + authenticated don't hold SELECT grants on after Plan 39
  // C2. Elevate to service-role for the lookup + recordLogin.
  const svc = getServiceRoleSupabase();
  const { data: pub } = await svc
    .from("users")
    .select("id")
    .eq("supabase_auth_id", data.user.id)
    .single();
  if (!pub) {
    redirect(`/login?error=${encodeURIComponent("Account not provisioned")}`);
  }

  const h = await headers();
  await recordLogin(svc, {
    publicUserId: pub.id,
    ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0",
    userAgent: h.get("user-agent") ?? "",
    acceptLanguage: h.get("accept-language") ?? "",
  });

  if (nextParam) {
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
