import type { SupabaseClient } from "@supabase/supabase-js";
import { hasPermAsync, PermissionError } from "@/lib/perms-db";
import type { Actor } from "@/perms";

/**
 * Plan 40 (P40-B) — Profile read module.
 *
 * `getProfileView` is the single server-side entry point used by the
 * `/profile` and `/profile/[userId]` routes. Callers pass:
 *
 *   - `sb` — SupabaseClient. For self-view callers pass the SSR anon client
 *     (RLS policy `users_self_select` grants the caller their own PII row).
 *     For admin cross-view callers pass the service-role client.
 *   - `actor` — `{ userId, roles }` resolved from session.
 *   - `targetUserId` — omitted OR equal to `actor.userId` → self view.
 *                      otherwise the caller must have `users.edit.any`
 *                      permission (admin wildcard satisfies this).
 *
 * Throws `PermissionError` when a non-admin tries to view another user's
 * profile; route components catch this and translate to `notFound()`
 * (403-as-404 shim per Plan 40 spec §3.2).
 */

export type ProfileView = {
  userId: string;
  displayName: string;
  email: string;
  photoUrl: string | null;
  bio: string | null;
  gamerTag: string | null;
  jerseyNumber: number | null;
  organizationId: string | null;
  roles: string[];
  hasPlayerRow: boolean;
};

type UsersRow = {
  id: string;
  email: string | null;
  display_name: string | null;
};

type PlayersRow = {
  gamer_tag: string | null;
  jersey_number: number | null;
  photo_url: string | null;
  bio: string | null;
  organization_id: string | null;
};

type UserRolesRow = {
  role: string;
};

export async function getProfileView(
  sb: SupabaseClient,
  actor: Actor,
  targetUserId?: string,
): Promise<ProfileView> {
  if (!actor.userId) {
    throw new PermissionError("getProfileView: unauthenticated actor");
  }

  const selfView = !targetUserId || targetUserId === actor.userId;
  const userIdToRead = selfView ? (actor.userId as string) : targetUserId;

  if (!selfView) {
    // Admin-only cross-view. Uses Plan 40 perm `users.edit.any`; admin
    // wildcard rule ("*") satisfies this through `matchesPerm`.
    const allowed = await hasPermAsync(sb, actor, "users.edit.any");
    if (!allowed) {
      throw new PermissionError(
        `getProfileView: actor lacks users.edit.any for target ${userIdToRead}`,
      );
    }
  }

  // 1. users row — PII (email, display_name).
  const { data: userRow, error: userErr } = await sb
    .from("users")
    .select("id, email, display_name")
    .eq("id", userIdToRead)
    .is("deleted_at", null)
    .maybeSingle<UsersRow>();
  if (userErr) {
    throw new Error(`getProfileView: users lookup failed: ${userErr.message}`);
  }
  if (!userRow) {
    throw new Error(`getProfileView: user ${userIdToRead} not found`);
  }

  // 2. players row — optional. Plan 40 edits bio + photo_url here.
  const { data: playerRow, error: playerErr } = await sb
    .from("players")
    .select("gamer_tag, jersey_number, photo_url, bio, organization_id")
    .eq("user_id", userIdToRead)
    .is("deleted_at", null)
    .maybeSingle<PlayersRow>();
  if (playerErr) {
    throw new Error(
      `getProfileView: players lookup failed: ${playerErr.message}`,
    );
  }

  // 3. all active roles for the target user.
  const { data: roleRows, error: rolesErr } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", userIdToRead)
    .is("deleted_at", null);
  if (rolesErr) {
    throw new Error(
      `getProfileView: user_roles lookup failed: ${rolesErr.message}`,
    );
  }
  const roles = ((roleRows ?? []) as UserRolesRow[])
    .map((r) => r.role)
    .sort();

  return {
    userId: userRow.id,
    displayName: (userRow.display_name ?? "").trim() || (userRow.email ?? "").split("@")[0] || "",
    email: userRow.email ?? "",
    photoUrl: playerRow?.photo_url ?? null,
    bio: playerRow?.bio ?? null,
    gamerTag: playerRow?.gamer_tag ?? null,
    jerseyNumber: playerRow?.jersey_number ?? null,
    organizationId: playerRow?.organization_id ?? null,
    roles,
    hasPlayerRow: !!playerRow,
  };
}

export { PermissionError } from "@/lib/perms-db";
