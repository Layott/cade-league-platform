import type { SupabaseClient } from "@supabase/supabase-js";
import { invalidate } from "./cache";
import type { BulkSaveMatrixInput, TogglePermissionInput } from "./schemas";

/**
 * CRUD for role_permissions. All writes go through a service-role client so
 * the audit trigger captures `actor_user_id` via `app.current_user_id`.
 *
 * `admin × *` is locked: we never DELETE that row. See spec §8.7.
 */

export async function listAllPermissions(
  sb: SupabaseClient,
): Promise<string[]> {
  const { data, error } = await sb
    .from("role_permissions")
    .select("permission");
  if (error) throw new Error(`listAllPermissions failed: ${error.message}`);
  const seen = new Set<string>();
  for (const row of (data ?? []) as { permission: string }[]) {
    seen.add(row.permission);
  }
  return Array.from(seen);
}

export async function listPermissionsForRole(
  sb: SupabaseClient,
  role: string,
): Promise<string[]> {
  const { data, error } = await sb
    .from("role_permissions")
    .select("permission")
    .eq("role", role);
  if (error)
    throw new Error(`listPermissionsForRole(${role}) failed: ${error.message}`);
  return ((data ?? []) as { permission: string }[]).map((r) => r.permission);
}

export type TogglePermissionArgs = TogglePermissionInput & {
  actorUserId: string;
};

export async function togglePermission(
  sb: SupabaseClient,
  args: TogglePermissionArgs,
): Promise<void> {
  const { role, permission, grant, actorUserId } = args;

  // Hard guard: never allow the admin wildcard to be removed — it would
  // lock every admin out of the console in one click. Spec §8.7.
  if (!grant && role === "admin" && permission === "*") {
    throw new Error(
      "admin wildcard is locked — revoke specific permissions on other roles instead",
    );
  }

  if (grant) {
    // Idempotent grant — if the row already exists, skip (DB is not hit by
    // an upsert with ignoreDuplicates so the trigger doesn't fire twice).
    const { error } = await sb
      .from("role_permissions")
      .upsert(
        { role, permission, granted_by: actorUserId },
        { onConflict: "role,permission", ignoreDuplicates: true },
      );
    if (error) {
      throw new Error(`togglePermission grant failed: ${error.message}`);
    }
  } else {
    const { error } = await sb
      .from("role_permissions")
      .delete()
      .eq("role", role)
      .eq("permission", permission);
    if (error) {
      throw new Error(`togglePermission revoke failed: ${error.message}`);
    }
  }

  invalidate(role);
}

export async function bulkSaveMatrix(
  sb: SupabaseClient,
  input: BulkSaveMatrixInput,
  actorUserId: string,
): Promise<void> {
  // Wildcard guard first — spec §8 Risk 7.
  for (const d of input.diff) {
    if (!d.grant && d.role === "admin" && d.permission === "*") {
      throw new Error(
        "admin wildcard is locked — cannot revoke ('admin','*')",
      );
    }
  }

  // Order: DELETE first, then INSERT (spec §8 Risk 2). This avoids a
  // situation where an immediate re-grant in the same diff races the
  // delete and ends up no-op.
  const toDelete = input.diff.filter((d) => !d.grant);
  const toGrant = input.diff.filter((d) => d.grant);

  const affectedRoles = new Set<string>();

  for (const d of toDelete) {
    const { error } = await sb
      .from("role_permissions")
      .delete()
      .eq("role", d.role)
      .eq("permission", d.permission);
    if (error) {
      throw new Error(
        `bulkSaveMatrix delete (${d.role},${d.permission}) failed: ${error.message}`,
      );
    }
    affectedRoles.add(d.role);
  }

  if (toGrant.length > 0) {
    const rows = toGrant.map((d) => ({
      role: d.role,
      permission: d.permission,
      granted_by: actorUserId,
    }));
    const { error } = await sb
      .from("role_permissions")
      .upsert(rows, {
        onConflict: "role,permission",
        ignoreDuplicates: true,
      });
    if (error) {
      throw new Error(`bulkSaveMatrix insert failed: ${error.message}`);
    }
    for (const d of toGrant) affectedRoles.add(d.role);
  }

  // Invalidate cache for every role we touched so subsequent reads see
  // the new state without waiting for the 30s TTL to expire.
  for (const r of affectedRoles) invalidate(r);
}
