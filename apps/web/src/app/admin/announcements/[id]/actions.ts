"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync } from "@/lib/perms-db";
import { enforceAuthedWrite } from "@/lib/api-rate-limit";
import { publishNow, unpublish } from "@/server/announcements";

export async function publishNowFromDetail(formData: FormData) {
  // Sanitize id BEFORE any DB lookup. Bare strings without UUID validation
  // composed into Supabase filter strings have caused injection-shape bugs
  // before (Plan 39 audit). Reject unknown shapes early.
  const id = z.string().uuid().parse(String(formData.get("id") ?? ""));

  const sb = await getServerSupabase();
  const { data } = await sb.auth.getUser();
  if (!data.user) redirect("/login");
  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", data.user.id)
    .single();
  if (!pub) redirect("/login");
  const { data: roleRows } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  // Plan 39 sanitize hardening — this action previously had no perm
  // gate. Anybody who could land a POST against it (any signed-in user)
  // could have published any announcement they knew the id of. Now
  // gated on `announcements.publish` (admin + production by default).
  const svc = getServiceRoleSupabase();
  await requirePermAsync(svc, { userId: pub.id, roles }, "announcements.publish");
  const limited = await enforceAuthedWrite(pub.id);
  if (limited) throw new Error("rate_limited");

  await publishNow(sb, id, pub.id);
  revalidatePath(`/admin/announcements/${id}`);
  revalidatePath("/admin/announcements");
  revalidatePath("/announcements");
}

export async function unpublishFromDetail(formData: FormData) {
  const id = z.string().uuid().parse(String(formData.get("id") ?? ""));

  const sb = await getServerSupabase();
  const { data } = await sb.auth.getUser();
  if (!data.user) redirect("/login");
  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", data.user.id)
    .single();
  if (!pub) redirect("/login");
  const { data: roleRows } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  const svc = getServiceRoleSupabase();
  await requirePermAsync(svc, { userId: pub.id, roles }, "announcements.publish");
  const limited = await enforceAuthedWrite(pub.id);
  if (limited) throw new Error("rate_limited");

  await unpublish(svc, id);
  revalidatePath(`/admin/announcements/${id}`);
  revalidatePath("/admin/announcements");
  revalidatePath("/announcements");
}
