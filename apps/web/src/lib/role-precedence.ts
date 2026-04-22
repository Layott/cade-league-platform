import type { RoleName } from "@/perms";

/**
 * Plan 40 P40-A — role precedence for the header `<UserBadge />` chip.
 *
 * The chip shows a single "highest" role even when the user holds several
 * (e.g. a match-day referee who is also a player, or a moderator who is
 * also a team_manager). Ordering is product-dictated, not alphabetic:
 *
 *   admin > loc > idc > referee > technical > production
 *         > moderator > design > coach > team_manager > player > viewer
 *
 * Keep in sync with Plan 40 spec §3.1. `viewer` is the conventional
 * fallback for unauthenticated / permissionless users (see `PUBLIC_PERMS`
 * in `src/perms.ts`).
 *
 * Note: deliberately NOT sourced from `ROLE_NAMES` in `perms.ts` — that
 * array happens to carry this same order today but the two concepts are
 * distinct (seed-definition order vs. UI precedence). Keeping them
 * separate avoids surprise when `perms.ts` is reshuffled in the future.
 */
export const ROLE_PRECEDENCE = [
  "admin",
  "loc",
  "idc",
  "referee",
  "technical",
  "production",
  "moderator",
  "design",
  "coach",
  "team_manager",
  "player",
  "viewer",
] as const satisfies readonly RoleName[];

export type PrecedenceRole = (typeof ROLE_PRECEDENCE)[number];

/**
 * Returns the highest-precedence role present in `roles`, or `null` when
 * the input is empty or contains only unknown role strings. Unknown
 * values are silently dropped (defensive — the DB could theoretically
 * hold a stale role after a migration).
 */
export function highestRole(roles: readonly string[]): PrecedenceRole | null {
  if (!roles || roles.length === 0) return null;
  const set = new Set(roles);
  for (const r of ROLE_PRECEDENCE) {
    if (set.has(r)) return r;
  }
  return null;
}
