/**
 * Plan 12 — broadcast permission string constants.
 *
 * Re-exported for grep-ability. Both are checked at the API layer via
 * `hasPermAsync` / `requirePermAsync` from `lib/perms-db.ts` against the
 * DB-backed `role_permissions` table (runtime source of truth) — these
 * constants are not the seed. See `src/perms.ts` for the seed doc.
 */

export const BROADCAST_PERMS = {
  trigger: "broadcast.trigger",
  manage: "broadcast.manage",
} as const;

export type BroadcastPerm = (typeof BROADCAST_PERMS)[keyof typeof BROADCAST_PERMS];
