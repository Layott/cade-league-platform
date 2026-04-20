export type RoleName = "admin" | "moderator" | "player";

export const PERMS: Record<RoleName, readonly string[]> = {
  admin: ["*"],
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
  player: [
    "matches.read",
    "standings.read",
    "announcements.read.own",
    "profile.edit.own",
  ],
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

function matchesPerm(rule: string, action: string): boolean {
  if (rule === "*") return true;
  if (rule === action) return true;
  if (rule.endsWith(".*")) {
    const prefix = rule.slice(0, -1);
    return action.startsWith(prefix);
  }
  return false;
}

export function hasPerm(actor: Actor, action: string): boolean {
  if (PUBLIC_PERMS.some((r) => matchesPerm(r, action))) return true;
  for (const role of actor.roles) {
    const rules = PERMS[role as RoleName];
    if (!rules) continue;
    if (rules.some((r) => matchesPerm(r, action))) return true;
  }
  return false;
}
