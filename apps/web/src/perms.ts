// SEED ONLY — at runtime, permissions are read from the `role_permissions`
// DB table via `lib/perms-db.ts` (hasPermAsync / requirePermAsync).
//
// The `PERMS` constant below is the seed used by migration
// `20260428000003_role_permissions_seed.sql` to populate the table on a fresh
// deploy, and is imported by `perms.seed.test.ts` to assert the seed contract.
// Add a role's seed entry here ONLY when scaffolding a new role; grant/revoke
// at runtime goes through /admin/roles (writes to role_permissions).
//
// PUBLIC_PERMS stays in-process — unauthenticated public pages must not hit
// the DB for permission checks. Keep it in sync with the viewer role row set.
//
// The sync `hasPerm` helper is kept for edge cases where no SupabaseClient is
// available (fully public SSR). Prefer `hasPermAsync` from `lib/perms-db.ts`.

export const ROLE_NAMES = [
  "admin",
  "loc",
  "idc",
  "referee",
  "technical",
  "production",
  "design",
  "moderator",
  "coach",
  "team_manager",
  "player",
  "viewer",
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

export const PERMS: Record<RoleName, readonly string[]> = {
  admin: ["*"],
  loc: [],
  idc: [],
  referee: [],
  technical: [],
  production: ["broadcast.trigger"],
  design: [],
  moderator: [
    "announcements.*",
    "punishments.issue",
    "punishments.edit",
    "punishments.read",
    "attendance.mark",
    "attendance.edit",
    "matches.read",
    "standings.read",
    "audit.read",
  ],
  coach: [],
  team_manager: [],
  player: [
    "matches.read",
    "standings.read",
    "announcements.read.own",
    "profile.edit.own",
  ],
  viewer: [],
} as const;

export const PUBLIC_PERMS: readonly string[] = [
  "matches.read.public",
  "standings.read.public",
  "announcements.read.public",
  "players.read.public",
  "fixtures.read.public",
  "punishments.read.public",
];

export type Actor = { userId: string | null; roles: readonly string[] };

export function matchesPerm(rule: string, action: string): boolean {
  if (rule === "*") return true;
  if (rule === action) return true;
  if (rule.endsWith(".*")) {
    const prefix = rule.slice(0, -1);
    return action.startsWith(prefix);
  }
  return false;
}

/**
 * Synchronous fallback permission check against the hard-coded seed map.
 * Prefer `hasPermAsync` from `lib/perms-db.ts` in all new code — the DB
 * table is the runtime source of truth and the seed lags admin edits.
 */
export function hasPerm(actor: Actor, action: string): boolean {
  if (PUBLIC_PERMS.some((r) => matchesPerm(r, action))) return true;
  for (const role of actor.roles) {
    const rules = PERMS[role as RoleName];
    if (!rules) continue;
    if (rules.some((r) => matchesPerm(r, action))) return true;
  }
  return false;
}
