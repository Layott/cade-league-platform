"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Plan 13B — Player subnav. Mirrors AdminSubnav's tab-strip pattern but
 * runs on the default (non-admin-dark) background so the player console
 * stays visually distinct from /admin. Every `player` role holder sees
 * every tab (Plan 13A seeded disputes/appeals perms on player); any
 * surface the viewer lacks perm for still denies at page-level.
 *
 * Plan 33 (2026-04-22): "Content" tab removed — content obligations
 * feature was dropped per user direction.
 *
 * 2026-04-24 — "Profile" tab now points directly at `/profile` (rich
 * self-view under the (auth) group). `/player/profile` is preserved as a
 * redirect stub for stale deep links but the subnav skips the hop.
 * Audit 2026-04-24 stub-page sweep.
 *
 * UI Audit Slice 2 (2026-04-28) — collapsed Disputes + Appeals into
 * a single "Cases" tab pointing at /player/cases (segmented control
 * inside). Subnav drops 4 → 3 tabs. Old /player/disputes +
 * /player/appeals 307 to /player/cases?tab=… so any deep link still
 * lands on the right segment.
 */

const TABS = [
  { href: "/player/squad", label: "Squad" },
  { href: "/player/cases", label: "Cases" },
  { href: "/profile", label: "Profile" },
];

function matches(pathname: string, href: string) {
  // /player/cases is "active" for both ?tab=disputes and ?tab=appeals,
  // and for the legacy /player/disputes + /player/appeals paths in the
  // brief window between server-rendering and the 307 redirect.
  if (href === "/player/cases") {
    return (
      pathname === "/player/cases" ||
      pathname.startsWith("/player/cases/") ||
      pathname === "/player/disputes" ||
      pathname.startsWith("/player/disputes/") ||
      pathname === "/player/appeals" ||
      pathname.startsWith("/player/appeals/")
    );
  }
  return pathname === href || pathname.startsWith(href + "/");
}

export function PlayerSubnav() {
  const pathname = usePathname() ?? "/player/squad";
  return (
    <nav
      aria-label="Player sections"
      className="mb-6 flex flex-wrap items-center gap-1 border-b border-[var(--ink-4)] pt-1"
      data-testid="player-subnav"
    >
      {TABS.map((tab) => {
        const active = matches(pathname, tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={
              "relative px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] transition-colors " +
              (active
                ? "text-[var(--chalk-0)]"
                : "text-[var(--chalk-3)] hover:text-[var(--chalk-0)]")
            }
          >
            {tab.label}
            <span
              aria-hidden
              className={
                "pointer-events-none absolute inset-x-3 -bottom-[1px] h-[2px] transition-all " +
                (active ? "bg-[var(--signal)]" : "bg-transparent")
              }
            />
          </Link>
        );
      })}
    </nav>
  );
}
