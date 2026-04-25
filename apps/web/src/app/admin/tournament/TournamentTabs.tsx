"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TOURNAMENT_TABS } from "./tabs.config";

/**
 * Plan 51 — sub-tab strip for the /admin/tournament console.
 *
 * The TOURNAMENT_TABS array now lives in `./tabs.config.ts` so the server
 * layout can iterate it (importing arrays from a "use client" module
 * turns them into client-reference proxies on the server).
 */

export { TOURNAMENT_TABS } from "./tabs.config";

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
