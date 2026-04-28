/**
 * UI Audit Slice 4 (2026-04-28) — single source of truth for admin IA v2.
 *
 * Three parallel admin navs (`AdminSubnav`, `NavDrawer` Staff group,
 * `/admin/page.tsx` tile grid) used to drift independently. They now all
 * render from `ADMIN_HUBS` so adding/renaming/dropping a hub is a one-file
 * change. Sub-tabs render the hub-internal strip (`HubSubnav`).
 *
 * 8 hubs (collapsed from 16 top-level admin tabs):
 *   1. Match days   /admin/match-days
 *   2. Tournament   /admin/tournament
 *   3. Roster       /admin/people
 *   4. Discipline   /admin/discipline
 *   5. Comms        /admin/announcements
 *   6. Broadcast    /admin/broadcast/v2
 *   7. Squads       /admin/squads
 *   8. System       /admin/system
 *
 * Match days remains its own hub (audit suggested merging into Tournament;
 * rejected because Mon-Fri operational rhythm makes it the most-trafficked
 * admin surface during a season).
 *
 * Perm strings re-use existing keys from `src/perms.ts` + the seeded rows
 * in `supabase/migrations/*role_permissions*`. Do NOT invent new perms
 * here without seeding them.
 */

export type AdminSubtab = {
  /** url segment key, e.g. "fixtures" */
  key: string;
  /** human label rendered in the strip */
  label: string;
  /** absolute href */
  href: string;
  /** optional perm gate; falls back to hub.perm */
  perm?: string;
  /**
   * Optional regex matcher for active-state — defaults to startsWith(href).
   * Stored as a STRING (regex source) not a RegExp object so the hub config
   * is serializable across the server → client boundary. React Server
   * Components can't serialize RegExp instances; passing one as a prop to
   * a "use client" component throws a server-side render error
   * (digest 3068007190 caught on /admin/announcements 2026-04-28).
   */
  segmentMatcher?: string;
};

export type AdminHub = {
  /** stable key, e.g. "tournament" */
  key: string;
  /** human label, e.g. "Tournament" */
  label: string;
  /** canonical hub URL, e.g. "/admin/tournament" */
  href: string;
  /** READ perm required to see this hub */
  perm: string;
  /** description for tile + drawer tooltip */
  description: string;
  /** optional sub-tab strip rendered inside the hub layout */
  subtabs?: readonly AdminSubtab[];
};

export const ADMIN_HUBS: readonly AdminHub[] = [
  {
    key: "match-days",
    label: "Match days",
    href: "/admin/match-days",
    perm: "matches.read",
    description: "Schedule, attendance, OCR stats review.",
    subtabs: [
      {
        key: "calendar",
        label: "Calendar",
        href: "/admin/match-days",
        perm: "matches.read",
      },
      {
        key: "stats-review",
        label: "Stats Review",
        href: "/admin/match-days/stats-review",
        perm: "stats.screenshot.review",
      },
    ],
  },
  {
    key: "tournament",
    label: "Tournament",
    href: "/admin/tournament",
    perm: "tournament.read",
    description: "Standings, fixtures, results, walkovers, tiebreakers.",
    subtabs: [
      {
        key: "standings",
        label: "Standings",
        href: "/admin/tournament/standings",
        perm: "tournament.read",
      },
      {
        key: "fixtures",
        label: "Fixtures",
        href: "/admin/tournament/fixtures",
        perm: "tournament.read",
      },
      {
        key: "results-entry",
        label: "Results Entry",
        href: "/admin/tournament/results-entry",
        perm: "tournament.score_entry",
      },
      {
        key: "walkovers",
        label: "Walkovers",
        href: "/admin/tournament/walkovers",
        perm: "tournament.walkover_confirm",
      },
      {
        key: "adjustments",
        label: "Adjustments",
        href: "/admin/tournament/adjustments",
        perm: "tournament.score_entry",
      },
      {
        key: "tiebreaker-config",
        label: "Tiebreaker Config",
        href: "/admin/tournament/tiebreaker-config",
        perm: "tournament.tiebreaker_config",
      },
      {
        key: "h2h-lookup",
        label: "H2H Lookup",
        href: "/admin/tournament/h2h-lookup",
        perm: "tournament.read",
      },
      {
        key: "win-prob-preview",
        label: "Win-Prob Preview",
        href: "/admin/tournament/win-prob-preview",
        perm: "tournament.read",
      },
    ],
  },
  {
    key: "roster",
    label: "Roster",
    href: "/admin/people",
    perm: "users.edit",
    description: "Players, orgs, contracts, ledger, accounts, roles.",
    subtabs: [
      {
        key: "players",
        label: "Players",
        href: "/admin/people/players",
        perm: "users.edit",
      },
      {
        key: "orgs",
        label: "Orgs",
        href: "/admin/people/orgs",
        perm: "orgs.read",
      },
      {
        key: "users",
        label: "Users",
        href: "/admin/people/users",
        perm: "users.manage",
      },
      {
        key: "roles",
        label: "Roles",
        href: "/admin/people/roles",
        perm: "roles.manage",
      },
      {
        key: "sessions",
        label: "Sessions",
        href: "/admin/people/security/sessions",
        perm: "security.sessions.read",
      },
    ],
  },
  {
    key: "discipline",
    label: "Discipline",
    href: "/admin/discipline",
    perm: "punishments.read",
    description: "Punishments, disputes, appeals, precedents.",
    subtabs: [
      {
        key: "punishments",
        label: "Punishments",
        href: "/admin/discipline/punishments",
        perm: "punishments.read",
      },
      {
        key: "disputes",
        label: "Disputes",
        href: "/admin/discipline/disputes",
        perm: "disputes.read",
      },
      {
        key: "appeals",
        label: "Appeals",
        href: "/admin/discipline/appeals",
        perm: "appeals.read",
      },
      {
        key: "precedents",
        label: "Precedents",
        href: "/admin/discipline/precedents",
        perm: "punishments.read",
      },
    ],
  },
  {
    key: "comms",
    label: "Comms",
    href: "/admin/announcements",
    perm: "announcements.read",
    description: "Drafts, published briefings, notifications log.",
    subtabs: [
      {
        key: "drafts",
        label: "Drafts",
        href: "/admin/announcements?tab=drafts",
        perm: "announcements.read",
        // /admin/announcements + ?tab=drafts is the default view
        segmentMatcher: "^/admin/announcements(/?$|\\?|$)",
      },
      {
        key: "published",
        label: "Published",
        href: "/admin/announcements?tab=published",
        perm: "announcements.read",
      },
    ],
  },
  {
    key: "broadcast",
    label: "Broadcast",
    href: "/admin/broadcast/v2",
    perm: "broadcast.v2.read",
    description: "Sessions, stingers, branding, YouTube channels.",
    subtabs: [
      {
        key: "sessions",
        label: "Sessions",
        href: "/admin/broadcast/v2",
        perm: "broadcast.v2.read",
      },
      {
        key: "stingers",
        label: "Stingers",
        href: "/admin/broadcast/v2/stingers",
        perm: "broadcast.v2.read",
      },
      {
        key: "branding",
        label: "Branding",
        href: "/admin/broadcast/v2/branding",
        perm: "broadcast.v2.read",
      },
      {
        key: "youtube",
        label: "YouTube",
        href: "/admin/broadcast/v2/youtube",
        perm: "broadcast.v2.read",
      },
    ],
  },
  {
    key: "squads",
    label: "Squads",
    href: "/admin/squads",
    perm: "squads.validate",
    description: "Submissions, validation rules, window override.",
    subtabs: [
      {
        key: "submissions",
        label: "Submissions",
        href: "/admin/squads",
        perm: "squads.validate",
      },
      {
        key: "rules",
        label: "Rules",
        href: "/admin/squads/rules",
        perm: "squads.validate",
      },
    ],
  },
  {
    key: "system",
    label: "System",
    href: "/admin/system",
    perm: "trash.restore",
    description: "Trash, audit log, db health.",
    subtabs: [
      {
        key: "trash",
        label: "Trash",
        href: "/admin/system/trash",
        perm: "trash.restore",
      },
    ],
  },
] as const;

export type AdminHubKey = (typeof ADMIN_HUBS)[number]["key"];

/** Map hub URL prefix → hub config. Used by middleware + breadcrumbs. */
export function findHubByPath(pathname: string): AdminHub | null {
  // Order matters: longer prefixes first so /admin/broadcast/v2 wins over /admin/broadcast.
  const hubs = [...ADMIN_HUBS].sort((a, b) => b.href.length - a.href.length);
  for (const hub of hubs) {
    if (pathname === hub.href || pathname.startsWith(hub.href + "/")) {
      return hub;
    }
  }
  return null;
}

/** Match a sub-tab against the current pathname. */
export function findSubtabByPath(
  hub: AdminHub,
  pathname: string,
): AdminSubtab | null {
  if (!hub.subtabs) return null;
  // Longer prefixes first, otherwise /admin/people/users would match /admin/people.
  const sorted = [...hub.subtabs].sort(
    (a, b) => b.href.length - a.href.length,
  );
  for (const tab of sorted) {
    if (tab.segmentMatcher) {
      if (new RegExp(tab.segmentMatcher).test(pathname)) return tab;
      continue;
    }
    // Strip query string from comparison href so /announcements?tab=drafts
    // still matches /admin/announcements.
    const cleanHref = tab.href.split("?")[0];
    if (pathname === cleanHref || pathname.startsWith(cleanHref + "/")) {
      return tab;
    }
  }
  // Default to first subtab when on the bare hub URL with no exact match.
  if (pathname === hub.href || pathname === hub.href + "/") {
    return hub.subtabs[0];
  }
  return null;
}

/**
 * Filter hubs to those visible to a viewer. Caller pre-resolves the
 * viewer's perms (e.g. via `hasPermAsync` or DB-cached `getRolePerms`)
 * and passes the effective perm strings. A wildcard `*` perm allows
 * everything.
 *
 * `userPerms` is the union of all rule strings the viewer has across
 * their roles + public perms. Matches use the same `matchesPerm`
 * semantics as `src/perms.ts` (`*`, exact, prefix.*).
 */
export function visibleHubs(
  userPerms: readonly string[],
): AdminHub[] {
  return ADMIN_HUBS.filter((hub) => permsAllow(userPerms, hub.perm));
}

/** Filter sub-tabs against viewer perms. */
export function visibleSubtabs(
  hub: AdminHub,
  userPerms: readonly string[],
): readonly AdminSubtab[] {
  if (!hub.subtabs) return [];
  return hub.subtabs.filter((tab) =>
    permsAllow(userPerms, tab.perm ?? hub.perm),
  );
}

/** Internal — apply perm-matching rules. */
function permsAllow(rules: readonly string[], action: string): boolean {
  for (const rule of rules) {
    if (rule === "*") return true;
    if (rule === action) return true;
    if (rule.endsWith(".*")) {
      const prefix = rule.slice(0, -1);
      if (action.startsWith(prefix)) return true;
    }
  }
  return false;
}
