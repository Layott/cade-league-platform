"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Plan 51 — sub-tab strip for the /admin/tournament console.
 *
 * Mirrors the TrashTabs pill style. Visibility is pre-filtered server-
 * side by the tournament layout against `hasPermAsync`; tabs the viewer
 * can't reach are dropped from `visibleTabs` before this component ever
 * renders.
 *
 * Tabs (in order):
 *   1. Standings           — read-only ranking + live stats.
 *   2. Fixtures            — round-robin grid + scheduling.
 *   3. Results Entry       — admin score entry workflow.
 *   4. Walkovers           — admin/ref pending + confirmed walkover queue.
 *   5. Adjustments         — manual point/GD overrides + audit trail.
 *   6. Tiebreaker Config   — edit seasons.tiebreaker_order.
 *   7. H2H Lookup          — head-to-head history viewer.
 *   8. Win-Prob Preview    — model-driven match preview tile.
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

export function TournamentTabs({
  visibleTabs,
}: {
  visibleTabs?: readonly string[];
}) {
  const pathname = usePathname() ?? "";
  const allowed = visibleTabs ? new Set(visibleTabs) : null;
  const tabs = allowed
    ? TOURNAMENT_TABS.filter((t) => allowed.has(t.href))
    : TOURNAMENT_TABS;
  return (
    <nav
      aria-label="Tournament sections"
      className="flex flex-wrap gap-1.5 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-1"
      data-testid="tournament-subnav"
    >
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={
              "whitespace-nowrap rounded-sm px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors " +
              (active
                ? "bg-[var(--signal)] text-[var(--signal-ink)]"
                : "text-[var(--chalk-2)] hover:bg-[var(--ink-3)] hover:text-[var(--chalk-0)]")
            }
            aria-current={active ? "page" : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
