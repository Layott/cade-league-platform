import type { SupabaseClient } from "@supabase/supabase-js";
import { type Actor, PUBLIC_PERMS, matchesPerm } from "@/perms";
import { getRolePerms } from "@/server/roles/cache";

/**
 * DB-backed permission check. Reads `role_permissions` through a 30s
 * process-local cache (`server/roles/cache.ts`). Plan 9 runtime source of
 * truth — the `PERMS` constant in `perms.ts` is only the seed.
 *
 * Public perms (PUBLIC_PERMS) are resolved in-process so unauthenticated
 * requests don't touch the DB for trivially public routes.
 */

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}

export async function hasPermAsync(
  sb: SupabaseClient,
  actor: Actor,
  action: string,
): Promise<boolean> {
  // Cheap in-process check first — keeps public pages off the DB.
  if (PUBLIC_PERMS.some((r) => matchesPerm(r, action))) return true;

  for (const role of actor.roles) {
    const rules = await getRolePerms(sb, role);
    if (rules.some((r) => matchesPerm(r, action))) return true;
  }
  return false;
}

export async function requirePermAsync(
  sb: SupabaseClient,
  actor: Actor,
  action: string,
): Promise<void> {
  if (!(await hasPermAsync(sb, actor, action))) {
    throw new PermissionError(`missing permission: ${action}`);
  }
}
