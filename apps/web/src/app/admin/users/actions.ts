"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync } from "@/lib/perms-db";
import { assignRole, removeRole } from "@/server/roles";
import { assignRoleSchema, removeRoleSchema } from "@/server/roles/schemas";
import {
  createUser,
  updateUser,
  resetUserPassword,
  softDeleteUser,
} from "@/server/users";
import {
  createUserSchema,
  updateUserSchema,
  resetUserPasswordSchema,
  softDeleteUserSchema,
} from "@/server/users/schemas";
import type { Actor } from "@/perms";

async function resolveActor(): Promise<{
  sb: ReturnType<typeof getServiceRoleSupabase>;
  actor: Actor;
}> {
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

  return {
    sb: getServiceRoleSupabase(),
    actor: { userId: pub.id as string, roles },
  };
}

async function requireUsersEdit(): Promise<{
  sb: ReturnType<typeof getServiceRoleSupabase>;
  actorUserId: string;
}> {
  const { sb, actor } = await resolveActor();
  await requirePermAsync(sb, actor, "users.edit");
  return { sb, actorUserId: actor.userId as string };
}

// ---------- existing role assign / remove ----------

export async function assignRoleAction(formData: FormData) {
  const input = assignRoleSchema.parse({
    userId: String(formData.get("userId") ?? ""),
    role: String(formData.get("role") ?? ""),
  });
  const { sb } = await requireUsersEdit();
  await assignRole(sb, input);
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${input.userId}`);
}

export async function removeRoleAction(formData: FormData) {
  const input = removeRoleSchema.parse({
    userId: String(formData.get("userId") ?? ""),
    role: String(formData.get("role") ?? ""),
  });
  const { sb } = await requireUsersEdit();
  await removeRole(sb, input);
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${input.userId}`);
}

// ---------- Plan 34 — full CRUD ----------

export async function createUserAction(formData: FormData) {
  const { sb, actor } = await resolveActor();

  const email = String(formData.get("email") ?? "").trim();
  const display_name = String(formData.get("display_name") ?? "").trim();
  const gamer_tag = String(formData.get("gamer_tag") ?? "").trim();
  const jersey_raw = String(formData.get("jersey_number") ?? "").trim();
  const password_raw = String(formData.get("password") ?? "");
  const role_raw = String(formData.get("role") ?? "").trim();

  const input = createUserSchema.parse({
    email,
    displayName: display_name,
    gamerTag: gamer_tag.length > 0 ? gamer_tag : undefined,
    jerseyNumber:
      jersey_raw.length > 0 ? Number.parseInt(jersey_raw, 10) : undefined,
    password: password_raw.length > 0 ? password_raw : undefined,
    roles: role_raw.length > 0 ? [role_raw] : undefined,
  });

  const created = await createUser(sb, actor, input);

  if (created.usedDefaultPassword && process.env.NODE_ENV === "production") {
    console.warn(
      `[users.createAction] PROD created ${input.email} with the default dev password — admin should rotate it.`,
    );
  }

  revalidatePath("/admin/users");
  redirect(`/admin/users/${created.id}`);
}

export async function updateUserAction(formData: FormData) {
  const { sb, actor } = await resolveActor();

  const id = String(formData.get("id") ?? "");
  const display_name = String(formData.get("display_name") ?? "").trim();
  const gamer_tag = String(formData.get("gamer_tag") ?? "").trim();
  const jersey_raw = String(formData.get("jersey_number") ?? "").trim();

  const input = updateUserSchema.parse({
    id,
    displayName: display_name.length > 0 ? display_name : undefined,
    gamerTag: gamer_tag.length > 0 ? gamer_tag : undefined,
    jerseyNumber:
      jersey_raw.length > 0 ? Number.parseInt(jersey_raw, 10) : undefined,
  });

  await updateUser(sb, actor, input);
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${id}`);
}

export async function resetPasswordAction(formData: FormData) {
  const { sb, actor } = await resolveActor();
  const input = resetUserPasswordSchema.parse({
    id: String(formData.get("id") ?? ""),
    newPassword: String(formData.get("new_password") ?? ""),
  });
  await resetUserPassword(sb, actor, input);
  revalidatePath(`/admin/users/${input.id}`);
}

export async function softDeleteUserAction(formData: FormData) {
  const { sb, actor } = await resolveActor();
  const input = softDeleteUserSchema.parse({
    id: String(formData.get("id") ?? ""),
  });
  await softDeleteUser(sb, actor, input);
  revalidatePath("/admin/users");
  revalidatePath("/admin/trash/users");
  redirect("/admin/users");
}
