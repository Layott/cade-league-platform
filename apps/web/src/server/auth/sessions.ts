import type { SupabaseClient } from "@supabase/supabase-js";
import { deviceFingerprint } from "./device";
import { sendNewDeviceAlert } from "./notify";

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
