import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePermAsync } from "@/lib/perms-db";
import type { Actor } from "@/perms";
import {
  createUserSchema,
  updateUserSchema,
  resetUserPasswordSchema,
  softDeleteUserSchema,
  restoreUserSchema,
  DEFAULT_DEV_PASSWORD,
  type CreateUserInput,
  type UpdateUserInput,
  type ResetUserPasswordInput,
  type SoftDeleteUserInput,
  type RestoreUserInput,
} from "./schemas";

/**
 * Admin user CRUD module (Plan 34).
 *
 * All writes go through the service-role Supabase client (the audit trigger
 * runs in DB so we get audit_events for free). Each fn first verifies the
 * caller has the required permission via the runtime DB-backed check.
 *
 * Soft-delete preserves auth.users so audit history + restore stay intact;
 * we only flip public.users.deleted_at and the matching user_roles rows.
 */

export type CreatedUser = {
  id: string;
  supabase_auth_id: string;
  usedDefaultPassword: boolean;
};

/**
 * Look up the public.users row mirrored by the Plan 1 trigger
 * (`handle_new_auth_user`) for the given supabase_auth_id. Polls a few
 * times because the trigger is async-ish in tests under transaction
 * snapshots — production is synchronous.
 */
async function findMirroredUserId(
  sb: SupabaseClient,
  authUserId: string,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await sb
      .from("users")
      .select("id")
      .eq("supabase_auth_id", authUserId)
      .maybeSingle();
    if (error) {
      throw new Error(`createUser: lookup failed: ${error.message}`);
    }
    if (data) return data.id as string;
    // Tiny back-off; the trigger fires synchronously in our setup but be defensive.
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(
    "createUser: handle_new_auth_user trigger did not mirror the row",
  );
}

export async function createUser(
  sb: SupabaseClient,
  actor: Actor,
  rawInput: CreateUserInput,
): Promise<CreatedUser> {
  await requirePermAsync(sb, actor, "users.create");
  const input = createUserSchema.parse(rawInput);

  const password = input.password ?? DEFAULT_DEV_PASSWORD;
  const usedDefaultPassword = !input.password;

  if (usedDefaultPassword && process.env.NODE_ENV === "production") {
    // Production safety net — the placeholder is dev-only. Surface this in
    // logs so an operator notices and rotates the password (or wires Resend).
    console.warn(
      `[users.create] using DEFAULT_DEV_PASSWORD for ${input.email} — admin must trigger a reset email.`,
    );
  }

  // 1. Create the auth.users row. The Plan 1 trigger mirrors it into
  //    public.users with display_name = split_part(email, '@', 1).
  const created = await sb.auth.admin.createUser({
    email: input.email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data?.user) {
    throw new Error(
      `createUser: auth.admin.createUser failed: ${created.error?.message ?? "unknown"}`,
    );
  }
  const authUser = created.data.user;

  // 2. Look up the mirrored public.users row.
  const publicUserId = await findMirroredUserId(sb, authUser.id);

  // 3. Update the mirrored row with the admin-supplied display name.
  const { error: updErr } = await sb
    .from("users")
    .update({
      display_name: input.displayName,
      updated_at: new Date().toISOString(),
    })
    .eq("id", publicUserId);
  if (updErr) {
    throw new Error(
      `createUser: users update failed: ${updErr.message}`,
    );
  }

  // 4. If gamer_tag or jersey provided, insert a players row.
  if (input.gamerTag || input.jerseyNumber !== undefined) {
    const { error: insPlayerErr } = await sb.from("players").insert({
      user_id: publicUserId,
      gamer_tag: input.gamerTag ?? input.displayName,
      jersey_number: input.jerseyNumber ?? null,
    });
    if (insPlayerErr) {
      throw new Error(
        `createUser: players insert failed: ${insPlayerErr.message}`,
      );
    }
  }

  // 5. Insert role rows (idempotent via upsert).
  if (input.roles && input.roles.length > 0) {
    const now = new Date().toISOString();
    const rows = input.roles.map((role) => ({
      user_id: publicUserId,
      role,
      deleted_at: null,
      updated_at: now,
    }));
    const { error: rolesErr } = await sb
      .from("user_roles")
      .upsert(rows, { onConflict: "user_id,role" });
    if (rolesErr) {
      throw new Error(
        `createUser: user_roles upsert failed: ${rolesErr.message}`,
      );
    }
  }

  return {
    id: publicUserId,
    supabase_auth_id: authUser.id,
    usedDefaultPassword,
  };
}

export async function updateUser(
  sb: SupabaseClient,
  actor: Actor,
  rawInput: UpdateUserInput,
): Promise<void> {
  await requirePermAsync(sb, actor, "users.edit");
  const input = updateUserSchema.parse(rawInput);

  const userPatch: Record<string, unknown> = {};
  if (input.displayName !== undefined) userPatch.display_name = input.displayName;

  if (Object.keys(userPatch).length > 0) {
    userPatch.updated_at = new Date().toISOString();
    const { error } = await sb
      .from("users")
      .update(userPatch)
      .eq("id", input.id);
    if (error) {
      throw new Error(`updateUser: users update failed: ${error.message}`);
    }
  }

  if (input.gamerTag !== undefined || input.jerseyNumber !== undefined) {
    const now = new Date().toISOString();
    // Look up an existing players row.
    const { data: existing, error: selErr } = await sb
      .from("players")
      .select("id")
      .eq("user_id", input.id)
      .maybeSingle();
    if (selErr) {
      throw new Error(
        `updateUser: players lookup failed: ${selErr.message}`,
      );
    }
    if (existing) {
      const patch: Record<string, unknown> = { updated_at: now };
      if (input.gamerTag !== undefined) patch.gamer_tag = input.gamerTag;
      if (input.jerseyNumber !== undefined)
        patch.jersey_number = input.jerseyNumber;
      const { error: updErr } = await sb
        .from("players")
        .update(patch)
        .eq("id", existing.id);
      if (updErr) {
        throw new Error(
          `updateUser: players update failed: ${updErr.message}`,
        );
      }
    } else {
      const { error: insErr } = await sb.from("players").insert({
        user_id: input.id,
        gamer_tag: input.gamerTag ?? "TBD",
        jersey_number: input.jerseyNumber ?? null,
      });
      if (insErr) {
        throw new Error(
          `updateUser: players insert failed: ${insErr.message}`,
        );
      }
    }
  }
}

export async function resetUserPassword(
  sb: SupabaseClient,
  actor: Actor,
  rawInput: ResetUserPasswordInput,
): Promise<void> {
  await requirePermAsync(sb, actor, "users.edit");
  const input = resetUserPasswordSchema.parse(rawInput);

  const { data: target, error: selErr } = await sb
    .from("users")
    .select("supabase_auth_id")
    .eq("id", input.id)
    .maybeSingle();
  if (selErr) {
    throw new Error(
      `resetUserPassword: lookup failed: ${selErr.message}`,
    );
  }
  if (!target?.supabase_auth_id) {
    throw new Error("resetUserPassword: user not found");
  }

  const res = await sb.auth.admin.updateUserById(
    target.supabase_auth_id as string,
    { password: input.newPassword },
  );
  if (res.error) {
    throw new Error(
      `resetUserPassword: auth.admin.updateUserById failed: ${res.error.message}`,
    );
  }
}

export async function softDeleteUser(
  sb: SupabaseClient,
  actor: Actor,
  rawInput: SoftDeleteUserInput,
): Promise<void> {
  await requirePermAsync(sb, actor, "users.delete");
  const input = softDeleteUserSchema.parse(rawInput);
  const now = new Date().toISOString();

  const { error: userErr } = await sb
    .from("users")
    .update({ deleted_at: now, updated_at: now })
    .eq("id", input.id)
    .is("deleted_at", null);
  if (userErr) {
    throw new Error(
      `softDeleteUser: users update failed: ${userErr.message}`,
    );
  }

  const { error: rolesErr } = await sb
    .from("user_roles")
    .update({ deleted_at: now, updated_at: now })
    .eq("user_id", input.id)
    .is("deleted_at", null);
  if (rolesErr) {
    throw new Error(
      `softDeleteUser: user_roles update failed: ${rolesErr.message}`,
    );
  }

  // Also soft-delete the matching players row, if any.
  const { error: playersErr } = await sb
    .from("players")
    .update({ deleted_at: now, updated_at: now })
    .eq("user_id", input.id)
    .is("deleted_at", null);
  if (playersErr) {
    throw new Error(
      `softDeleteUser: players update failed: ${playersErr.message}`,
    );
  }
}

export async function restoreUser(
  sb: SupabaseClient,
  actor: Actor,
  rawInput: RestoreUserInput,
): Promise<void> {
  await requirePermAsync(sb, actor, "users.delete");
  const input = restoreUserSchema.parse(rawInput);
  const now = new Date().toISOString();

  const { error } = await sb
    .from("users")
    .update({ deleted_at: null, updated_at: now })
    .eq("id", input.id);
  if (error) {
    throw new Error(`restoreUser: users update failed: ${error.message}`);
  }
  // Note: user_roles + players rows are NOT auto-restored; an admin can
  // re-assign through the existing UI. That avoids accidentally re-granting
  // a role the admin had already revoked separately before the soft-delete.
}

export {
  DEFAULT_DEV_PASSWORD,
  createUserSchema,
  updateUserSchema,
  resetUserPasswordSchema,
  softDeleteUserSchema,
  restoreUserSchema,
} from "./schemas";

export type {
  CreateUserInput,
  UpdateUserInput,
  ResetUserPasswordInput,
  SoftDeleteUserInput,
  RestoreUserInput,
} from "./schemas";
