/**
 * Plan 51 — shared sub-tab config for /admin/tournament/*.
 *
 * Lives in its own non-"use client" module so the Next.js server layout
 * can iterate the array. Exporting non-component values from a
 * "use client" module turns them into async client-reference proxies
 * on the server side (TOURNAMENT_TABS.map is not a function).
 */

export const TOURNAMENT_TABS = [
  { href: "/admin/tournament/standings", label: "Standings", perm: "tournament.read" },
  { href: "/admin/tournament/fixtures", label: "Fixtures", perm: "tournament.read" },
  {
    href: "/admin/tournament/results-entry",
    label: "Results Entry",
    perm: "tournament.score_entry",
  },
  {
    href: "/admin/tournament/walkovers",
    label: "Walkovers",
    perm: "tournament.walkover_confirm",
  },
  {
    href: "/admin/tournament/adjustments",
    label: "Adjustments",
    perm: "tournament.score_entry",
  },
  {
    href: "/admin/tournament/tiebreaker-config",
    label: "Tiebreaker Config",
    perm: "tournament.tiebreaker_config",
  },
  { href: "/admin/tournament/h2h-lookup", label: "H2H Lookup", perm: "tournament.read" },
  {
    href: "/admin/tournament/win-prob-preview",
    label: "Win-Prob Preview",
    perm: "tournament.read",
  },
] as const;

export type TournamentTabPerm = (typeof TOURNAMENT_TABS)[number]["perm"];
