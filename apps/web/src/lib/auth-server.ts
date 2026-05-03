/**
 * Plan 53 — Shared `requireActor(perm)` helper for API route handlers.
 *
 * Extracts the auth + perm + rate-limit guard pattern that lives inline at
 * `apps/web/src/app/admin/match-days/[id]/attendance/actions.ts:13-46`. The
 * helper reads the authenticated supabase user, looks up the public.users row
 * + roles, runs a DB-backed perm check via `hasPermAsync`, and applies the
 * authed-write rate limit. Throws `AuthError` on any failure so route
 * handlers can map to the correct HTTP status (401 / 403 / 429).
 *
 * Returns:
 *   - `sb`        — service-role client. Use for the actual mutation. RLS is
 *                   bypassed; audit context is controlled by the trigger.
 *   - `actor`     — `{ userId, roles }` shape (the canonical `Actor` type from
 *                   `@/perms`). Pass straight into the server-module mutators.
 *
 * Permission name is typed as `string` here (NOT a `PermName` union) so the
 * helper is shared across surfaces. The server modules themselves call
 * `requirePermAsync` again — defense in depth.
 */

import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { hasPermAsync } from "@/lib/perms-db";
import { enforceAuthedWrite } from "@/lib/api-rate-limit";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "@/perms";
import type { NextResponse } from "next/server";

export class AuthError extends Error {
  readonly code: "unauthorized" | "forbidden" | "rate_limited";
  readonly rateLimitResponse?: NextResponse;
  constructor(
    code: AuthError["code"],
    message: string,
    rateLimitResponse?: NextResponse,
  ) {
    super(message);
    this.code = code;
    this.name = "AuthError";
    this.rateLimitResponse = rateLimitResponse;
  }
}

export async function requireActor(perm: string): Promise<{
  sb: SupabaseClient;
  actor: Actor;
}> {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) throw new AuthError("unauthorized", "no auth user");

  const { data: pub } = await userClient
    .from("users")
    .select("id")
    .eq("supabase_auth_id", auth.user.id)
    .maybeSingle();
  if (!pub) throw new AuthError("unauthorized", "no public.users row");

  const { data: roleRows } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", pub.id)
    .is("deleted_at", null);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);

  // Plan 9 — DB-backed perm check via role_permissions (cached 30s). Service-
  // role client so the perms read sees the full table without RLS filtering.
  const sb = getServiceRoleSupabase();
  const actor: Actor = { userId: pub.id as string, roles };
  if (!(await hasPermAsync(sb, actor, perm))) {
    throw new AuthError("forbidden", `missing permission: ${perm}`);
  }

  const limited = await enforceAuthedWrite(pub.id);
  if (limited) {
    throw new AuthError("rate_limited", "rate limit exceeded", limited);
  }

  return { sb, actor };
}
