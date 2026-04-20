"use server";

import { redirect } from "next/navigation";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { revoke } from "@/server/punishments";

export async function revokeAction(formData: FormData) {
  const actionId = String(formData.get("actionId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!actionId || !reason) return;
  const service = getServiceRoleSupabase();
  await revoke(service, actionId, reason);
  redirect(`/admin/punishments/${actionId}`);
}
