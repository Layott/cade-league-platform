import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssignRoleInput, RemoveRoleInput } from "./schemas";

/**
 * User + role management for the admin /admin/users console.
 *
 * Assigns use an upsert (so re-assigning an existing role is a no-op).
 * Removes do a soft delete — consistent with every other mutable table in
 * Phase 1A and cleanly restoreable via /admin/trash.
 *
 * Writes go through the service-role client so RLS on user_roles
 * (self-read only) doesn't block admin assignments.
 */

export type UserWithRoles = {
  id: string;
  email: string;
  display_name: string | null;
  last_login_at: string | null;
  roles: string[];
};

export async function listUsersWithRoles(
  sb: SupabaseClient,
): Promise<UserWithRoles[]> {
  const { data: usersData, error: usersErr } = await sb
    .from("users")
    .select("id, email, display_name, last_login_at")
    .is("deleted_at", null)
    .order("email", { ascending: true });
  if (usersErr) {
    throw new Error(`listUsersWithRoles users failed: ${usersErr.message}`);
  }
  const users = (usersData ?? []) as {
    id: string;
    email: string;
    display_name: string | null;
    last_login_at: string | null;
  }[];
  if (users.length === 0) return [];

  const { data: rolesData, error: rolesErr } = await sb
    .from("user_roles")
    .select("user_id, role")
    .in(
      "user_id",
      users.map((u) => u.id),
    )
    .is("deleted_at", null);
  if (rolesErr) {
    throw new Error(`listUsersWithRoles roles failed: ${rolesErr.message}`);
  }

  const byUser = new Map<string, string[]>();
  for (const r of (rolesData ?? []) as { user_id: string; role: string }[]) {
    const arr = byUser.get(r.user_id) ?? [];
    arr.push(r.role);
    byUser.set(r.user_id, arr);
  }

  return users.map((u) => ({
    ...u,
    roles: (byUser.get(u.id) ?? []).sort(),
  }));
}

export async function assignRole(
  sb: SupabaseClient,
  input: AssignRoleInput,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await sb.from("user_roles").upsert(
    {
      user_id: input.userId,
      role: input.role,
      deleted_at: null,
      updated_at: now,
    },
    { onConflict: "user_id,role" },
  );
  if (error) throw new Error(`assignRole failed: ${error.message}`);
}

export async function removeRole(
  sb: SupabaseClient,
  input: RemoveRoleInput,
): Promise<void> {
  const now = new Date().toISOString();
  // Soft-delete the user_roles row. Unique index (user_id, role) prevents
  // duplicate rows, and we want re-assign to flip deleted_at back to null
  // via assignRole's upsert.
  const { error } = await sb
    .from("user_roles")
    .update({ deleted_at: now, updated_at: now })
    .eq("user_id", input.userId)
    .eq("role", input.role)
    .is("deleted_at", null);
  if (error) throw new Error(`removeRole failed: ${error.message}`);
}
