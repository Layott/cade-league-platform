"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";

export async function revokeSession(formData: FormData) {
  const sessionId = String(formData.get("sessionId") ?? "");
  const reason = String(formData.get("reason") ?? "admin_revoke");
  if (!sessionId) return;

  const sb = await getServerSupabase();
  await sb
    .from("sessions")
    .update({ revoked_at: new Date().toISOString(), revoke_reason: reason })
    .eq("id", sessionId);
  await sb.from("auth_events").insert({
    event_type: "session_revoked",
    metadata: { session_id: sessionId, reason },
  });
  revalidatePath("/admin/security/sessions");
}
