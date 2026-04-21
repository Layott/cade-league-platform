import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Process-local permission cache.
 *
 * One entry per role (max 12 entries — no LRU eviction needed). Each entry
 * is a snapshot of the permission strings granted to that role in
 * `role_permissions`, valid for 30 seconds.
 *
 * 30s TTL is picked so a permission toggle in `/admin/roles` becomes
 * visible everywhere within one admin's typical save→test cycle. Cross-
 * process invalidation (multiple Vercel nodes) piggy-backs on the TTL —
 * we accept up to 30s of staleness on peer nodes. If that ever bites,
 * switch to Postgres LISTEN/NOTIFY (see spec §8.1).
 */

type CacheEntry = { perms: readonly string[]; expiresAt: number };

const TTL_MS = 30_000;
const cache = new Map<string, CacheEntry>();

export async function getRolePerms(
  sb: SupabaseClient,
  role: string
): Promise<readonly string[]> {
  const now = Date.now();
  const hit = cache.get(role);
  if (hit && hit.expiresAt > now) return hit.perms;

  const { data, error } = await sb
    .from("role_permissions")
    .select("permission")
    .eq("role", role);
  if (error) {
    throw new Error(`role perms fetch failed: ${error.message}`);
  }
  const perms = ((data ?? []) as { permission: string }[]).map((r) => r.permission);
  cache.set(role, { perms, expiresAt: now + TTL_MS });
  return perms;
}

export function invalidate(role?: string): void {
  if (!role) cache.clear();
  else cache.delete(role);
}

// Test-only handles — do not import from production code.
export const __test = {
  size: () => cache.size,
  clearAll: () => cache.clear(),
  ttlMs: () => TTL_MS,
};
