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
  admin: [
    "*",
    "squads.reopen",
    "broadcast.match_control",
    "branding.manage",
    "squads.window.manage",
    "squads.player_override.manage",
    // Plan 51 — explicit seed entries for self-documenting role_permissions.
    // Wildcard '*' already grants these; we list them so /admin/roles shows
    // the surface clearly.
    "tournament.read",
    "tournament.score_entry",
    "tournament.walkover_confirm",
    "tournament.tiebreaker_config",
    "tournament.export",
    "broadcast.v2.read",
    "broadcast.v2.trigger",
  ],
  loc: [
    "squads.validate",
    "squads.change_authorize",
    "squads.window.manage",
    "squads.player_override.manage",
    // Plan 51 — read-only tournament view + report exports.
    "tournament.read",
    "tournament.export",
  ],
  idc: [
    // Plan 51 — read-only tournament view + report exports.
    "tournament.read",
    "tournament.export",
  ],
  // Plan 46 — refs mark attendance from /referee/attendance (migration
  // 20260510000200). attendance.edit lets them correct a prior mark.
  // Plan 51 — refs counter-confirm admin-initiated walkovers.
  referee: [
    "squads.validate",
    "squads.change_authorize",
    "squads.window.manage",
    "squads.player_override.manage",
    "attendance.mark",
    "attendance.edit",
    "tournament.walkover_confirm",
  ],
  technical: [
    // Plan 51 — read tournament data + drive broadcast v2 overlays.
    "tournament.read",
    "broadcast.v2.read",
    "broadcast.v2.trigger",
  ],
  production: [
    "broadcast.trigger",
    "match_clock.manage",
    // Plan 42 — match-aware overlays (select/start/end match + score controls)
    "broadcast.match_control",
    // Plan 51 — broadcast v2 overlay control room.
    "broadcast.v2.read",
    "broadcast.v2.trigger",
  ],
  design: [
    // Plan 51 — read-only access to broadcast v2 for review/QA.
    "broadcast.v2.read",
  ],
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
    // Plan 13A — governance review
    "orgs.read",
    "disputes.read",
    "disputes.rule",
    "appeals.read",
    "appeals.rule",
    // Plan 33 (2026-04-22) — `content.verify` + `preseason.manage` removed
    // when content obligations + preseason shoots features were dropped.
    // Plan 14 — stats OCR review (delete + re-run stay admin-only).
    "stats.screenshot.upload",
    "stats.screenshot.review",
  ],
  coach: [],
  team_manager: [],
  player: [
    "matches.read",
    "standings.read",
    "announcements.read.own",
    "profile.edit.own",
    // Plan 10 — own-submission squad pipeline
    "squads.submit.own",
    // Plan 13A — governance submissions + own-data reads
    "disputes.submit",
    "disputes.read.own",
    "appeals.submit",
    "appeals.read.own",
    // Plan 33 (2026-04-22) — `content.submit` + `content.read.own` removed
    // when content obligations feature was dropped.
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
