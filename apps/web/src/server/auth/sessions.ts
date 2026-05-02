import type { SupabaseClient } from "@supabase/supabase-js";
import { deviceFingerprint } from "./device";
import { sendNewDeviceAlert } from "./notify";

/**
 * Login lockout tunables (Bug 11 fix 2026-05-01).
 *
 * `LOCKOUT_WINDOW_MS` — how far back we count failed-login rows when
 * deciding if an email is locked. 5 minutes gives a legitimate user
 * room to recover from a typo or two without ever crossing the
 * threshold, while still slowing down credential-stuffing.
 *
 * `LOCKOUT_THRESHOLD` — number of failures within the window that flip
 * the user from "warning state" to "locked". The check uses STRICT
 * GREATER-THAN (`count > LOCKOUT_THRESHOLD`) so the 5th failure is the
 * last warning state, the 6th attempt is what actually locks. This
 * matches user perception ("5 attempts shown as warning, 6th is the
 * one that locks") and avoids the off-by-one we shipped pre-2026-05-01.
 */
export const LOCKOUT_WINDOW_MS = 5 * 60 * 1000;
export const LOCKOUT_THRESHOLD = 5;

export type RecordLoginInput = {
  publicUserId: string;
  ipAddress: string;
  userAgent: string;
  acceptLanguage: string;
};

export type RecordLoginResult = {
  sessionId: string;
  isNewDevice: boolean;
};

export type LockoutInfo = {
  /** True when the user has STRICTLY MORE THAN LOCKOUT_THRESHOLD failed
   *  attempts in the last LOCKOUT_WINDOW_MS. */
  locked: boolean;
  /** Total `login_failed` rows for this email's user_id in the window.
   *  0 when the email doesn't resolve to a public user row. */
  attemptsInWindow: number;
  /** Milliseconds until the EARLIEST in-window failure expires out of
   *  the window (i.e. how long until count drops below threshold).
   *  0 when not locked. */
  msRemaining: number;
};

export async function recordLogin(
  sb: SupabaseClient,
  input: RecordLoginInput
): Promise<RecordLoginResult> {
  const fp = deviceFingerprint({
    userAgent: input.userAgent,
    ip: input.ipAddress,
    acceptLanguage: input.acceptLanguage,
  });

  const [{ data: user }, { data: rolesRows }] = await Promise.all([
    sb.from("users").select("id, email, display_name").eq("id", input.publicUserId).single(),
    sb.from("user_roles").select("role").eq("user_id", input.publicUserId).is("deleted_at", null),
  ]);
  if (!user) throw new Error("user not found");

  const { data: priorSessions } = await sb
    .from("sessions")
    .select("id")
    .eq("user_id", input.publicUserId)
    .eq("device_fingerprint", fp)
    .is("deleted_at", null)
    .limit(1);
  const isNewDevice = !priorSessions || priorSessions.length === 0;

  const { data: session } = await sb
    .from("sessions")
    .insert({
      user_id: input.publicUserId,
      ip_address: input.ipAddress,
      user_agent: input.userAgent,
      device_fingerprint: fp,
    })
    .select("id, ip_address, user_agent, started_at")
    .single();
  if (!session) throw new Error("session insert failed");

  await Promise.all([
    sb.from("auth_events").insert({
      user_id: input.publicUserId,
      event_type: "login",
      ip_address: input.ipAddress,
      user_agent: input.userAgent,
      metadata: { device_fingerprint: fp, is_new_device: isNewDevice },
    }),
    sb.from("users").update({ last_login_at: new Date().toISOString() }).eq("id", input.publicUserId),
  ]);

  const roles = (rolesRows ?? []).map((r: { role: string }) => r.role);
  if (isNewDevice && roles.includes("admin")) {
    await sb.from("auth_events").insert({
      user_id: input.publicUserId,
      event_type: "new_device",
      ip_address: input.ipAddress,
      user_agent: input.userAgent,
      metadata: { device_fingerprint: fp },
    });
    await sendNewDeviceAlert(user, {
      ip_address: session.ip_address,
      user_agent: session.user_agent,
      started_at: session.started_at,
    });
  }

  return { sessionId: session.id, isNewDevice };
}

/**
 * Record a failed login attempt for forensic + lockout-counter use.
 * `email` is normalized (trim + lowercase) before any DB operation so
 * the lockout key + the auth_events.metadata.email match exactly.
 *
 * Failed attempts against an unknown email still get inserted with a
 * NULL `user_id` (we still want IP-bound forensic trails for stuffing
 * attempts against non-existent accounts) — they just can't trigger
 * the per-user-id lockout path because there's no user_id to scope to.
 */
export async function recordLoginFailure(
  sb: SupabaseClient,
  email: string,
  reason: string,
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("email", normalized)
    .is("deleted_at", null)
    .maybeSingle();
  await sb.from("auth_events").insert({
    user_id: pub?.id ?? null,
    event_type: "login_failed",
    metadata: { email: normalized, reason },
  });
}

/**
 * One-shot lockout probe.
 *
 * Returns `{ locked, attemptsInWindow, msRemaining }`. `locked` is
 * `attemptsInWindow > LOCKOUT_THRESHOLD` (strictly greater than — so the
 * 5th attempt is still allowed, the 6th is what trips). `msRemaining`
 * is the time until the *earliest* in-window failure scrolls out of
 * the window (which is the soonest the user will be able to retry).
 *
 * Returns `{locked: false, ...}` for unknown emails — failed attempts
 * against non-existent accounts get logged (recordLoginFailure) but
 * don't gate.
 */
export async function getLockoutInfo(
  sb: SupabaseClient,
  email: string,
): Promise<LockoutInfo> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return { locked: false, attemptsInWindow: 0, msRemaining: 0 };
  }

  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("email", normalized)
    .is("deleted_at", null)
    .maybeSingle();
  if (!pub?.id) {
    return { locked: false, attemptsInWindow: 0, msRemaining: 0 };
  }

  const since = new Date(Date.now() - LOCKOUT_WINDOW_MS).toISOString();
  // Order ascending so element [0] is the EARLIEST in-window row, which
  // is what determines msRemaining (= when that row scrolls out).
  const { data: rows } = await sb
    .from("auth_events")
    .select("created_at")
    .eq("user_id", pub.id)
    .eq("event_type", "login_failed")
    .gte("created_at", since)
    .order("created_at", { ascending: true });

  const attempts = (rows ?? []) as Array<{ created_at: string }>;
  const attemptsInWindow = attempts.length;
  const locked = attemptsInWindow > LOCKOUT_THRESHOLD;
  let msRemaining = 0;
  if (locked && attempts[0]) {
    const earliest = new Date(attempts[0].created_at).getTime();
    msRemaining = Math.max(0, earliest + LOCKOUT_WINDOW_MS - Date.now());
  }
  return { locked, attemptsInWindow, msRemaining };
}

/**
 * Admin "unlock account" primitive.
 *
 * Deletes the in-window `login_failed` rows for the given email so the
 * lockout counter immediately drops below threshold. Forensic data
 * older than the window is preserved.
 *
 * Service-role only — no RLS escape hatch. Caller MUST gate on the
 * `users.unlock` permission first (the unlockPlayerAccountAction in
 * /admin/people/players does this).
 */
export async function clearLockoutForEmail(
  sb: SupabaseClient,
  email: string,
): Promise<{ cleared: number }> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return { cleared: 0 };

  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("email", normalized)
    .is("deleted_at", null)
    .maybeSingle();
  if (!pub?.id) return { cleared: 0 };

  const since = new Date(Date.now() - LOCKOUT_WINDOW_MS).toISOString();
  const { data: deleted, error } = await sb
    .from("auth_events")
    .delete()
    .eq("user_id", pub.id)
    .eq("event_type", "login_failed")
    .gte("created_at", since)
    .select("id");
  if (error) throw error;
  return { cleared: (deleted ?? []).length };
}
</content>
</invoke>