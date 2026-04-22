"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { requirePermAsync } from "@/lib/perms-db";
import type { Actor } from "@/perms";
import {
  updateOwnProfileSchema,
  updateOtherProfileSchema,
  parseProfileFormData,
} from "./schemas";

/**
 * Plan 40 (P40-B) — `/profile` edit actions.
 *
 * Two entry points:
 *   - `updateOwnProfileAction(formData)`   — self-edit; requires
 *     `profile.edit.own` (seeded to the `player` role; admin wildcard OK).
 *   - `updateOtherProfileAction(userId, formData)` — admin cross-edit;
 *     requires `users.edit.any`.
 *
 * Only three fields are writable: `display_name` (on users),
 * `bio` + `photo_url` (on players). Everything else is rejected — the schema
 * drops unknown keys because Zod objects default to stripping.
 */

async function resolveActor(): Promise<{
  sb: ReturnType<typeof getServiceRoleSupabase>;
  actor: Actor;
}> {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/profile");

  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) redirect("/login?next=/profile");

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

async function writeProfileFields(
  sb: ReturnType<typeof getServiceRoleSupabase>,
  targetUserId: string,
  fields: { displayName?: string; bio?: string; photoUrl?: string },
): Promise<void> {
  const now = new Date().toISOString();

  // 1. display_name on users.
  if (fields.displayName !== undefined) {
    const { error } = await sb
      .from("users")
      .update({ display_name: fields.displayName, updated_at: now })
      .eq("id", targetUserId);
    if (error) {
      throw new Error(`profile update (users): ${error.message}`);
    }
  }

  // 2. bio + photo_url on players (only if the user has a players row).
  //    Non-player users fall through — Plan 41 will add a user-avatars
  //    bucket + user-level bio column if that changes.
  if (fields.bio !== undefined || fields.photoUrl !== undefined) {
    const { data: existing, error: selErr } = await sb
      .from("players")
      .select("id")
      .eq("user_id", targetUserId)
      .is("deleted_at", null)
      .maybeSingle();
    if (selErr) {
      throw new Error(`profile lookup (players): ${selErr.message}`);
    }
    if (existing) {
      const patch: Record<string, unknown> = { updated_at: now };
      if (fields.bio !== undefined) patch.bio = fields.bio;
      if (fields.photoUrl !== undefined) patch.photo_url = fields.photoUrl;
      const { error: updErr } = await sb
        .from("players")
        .update(patch)
        .eq("id", existing.id);
      if (updErr) {
        throw new Error(`profile update (players): ${updErr.message}`);
      }
    }
    // No-op if there is no players row — non-player users cannot edit
    // bio/photo via Plan 40; Plan 41 adds the scaffold.
  }
}

export async function updateOwnProfileAction(formData: FormData) {
  const { sb, actor } = await resolveActor();
  await requirePermAsync(sb, actor, "profile.edit.own");

  const raw = parseProfileFormData(formData);
  const input = updateOwnProfileSchema.parse(raw);

  await writeProfileFields(sb, actor.userId as string, input);

  revalidatePath("/profile");
}

export async function updateOtherProfileAction(
  userId: string,
  formData: FormData,
) {
  const { sb, actor } = await resolveActor();
  await requirePermAsync(sb, actor, "users.edit.any");

  const raw = parseProfileFormData(formData);
  const input = updateOtherProfileSchema.parse({ userId, ...raw });

  await writeProfileFields(sb, input.userId, {
    displayName: input.displayName,
    bio: input.bio,
    photoUrl: input.photoUrl,
  });

  revalidatePath("/profile");
  revalidatePath(`/profile/${input.userId}`);
}
