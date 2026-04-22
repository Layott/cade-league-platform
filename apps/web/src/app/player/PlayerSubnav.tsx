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
 */

const TABS = [
  { href: "/player/squad", label: "Squad" },
  { href: "/player/disputes", label: "Disputes" },
  { href: "/player/appeals", label: "Appeals" },
  { href: "/player/profile", label: "Profile" },
];

function matches(pathname: string, href: string) {
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
