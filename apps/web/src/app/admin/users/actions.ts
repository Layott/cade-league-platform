"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync } from "@/lib/perms-db";
import { assignRole, removeRole } from "@/server/roles";
import { assignRoleSchema, removeRoleSchema } from "@/server/roles/schemas";

async function requireAdmin() {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login");

  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  const sb = getServiceRoleSupabase();
  await requirePermAsync(sb, { userId: pub.id, roles }, "users.edit");
  return { sb, actorUserId: pub.id as string };
}

export async function assignRoleAction(formData: FormData) {
  const input = assignRoleSchema.parse({
    userId: String(formData.get("userId") ?? ""),
    role: String(formData.get("role") ?? ""),
  });
  const { sb } = await requireAdmin();
  await assignRole(sb, input);
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${input.userId}`);
}

export async function removeRoleAction(formData: FormData) {
  const input = removeRoleSchema.parse({
    userId: String(formData.get("userId") ?? ""),
    role: String(formData.get("role") ?? ""),
  });
  const { sb } = await requireAdmin();
  await removeRole(sb, input);
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${input.userId}`);
}
