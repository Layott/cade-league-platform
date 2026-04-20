"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * AdminSubnav renders the cross-console tab strip. Active route is
 * highlighted with a signal-green underline + chalk-0 label, others fade
 * to chalk-2. Rendered client-side so `usePathname` determines active
 * state without server-round-trip.
 */

const TABS = [
  { href: "/admin", label: "Dashboard", exact: true },
  { href: "/admin/match-days", label: "Match days" },
  { href: "/admin/punishments", label: "Punishments" },
  { href: "/admin/announcements", label: "Announcements" },
  { href: "/admin/trash", label: "Trash" },
  { href: "/admin/security/sessions", label: "Sessions" },
];

function matches(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

export function AdminSubnav() {
  const pathname = usePathname() ?? "/admin";
  return (
    <nav
      aria-label="Admin sections"
      className="flex flex-wrap items-center gap-1 border-b border-[var(--ink-4)] bg-[var(--ink-1)]/80 px-1 pt-1"
      data-testid="admin-subnav"
    >
      {TABS.map((tab) => {
        const active = matches(pathname, tab.href, tab.exact);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={
              "relative px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] transition-colors " +
              (active
                ? "text-[var(--chalk-0)]"
                : "text-[var(--chalk-3)] hover:text-[var(--chalk-0)]")
            }
            aria-current={active ? "page" : undefined}
          >
            {tab.label}
            <span
              aria-hidden
              className={
                "pointer-events-none absolute inset-x-3 -bottom-[1px] h-[2px] transition-all " +
                (active
                  ? "bg-[var(--signal)]"
                  : "bg-transparent group-hover:bg-[var(--ink-5)]")
              }
            />
          </Link>
        );
      })}
    </nav>
  );
}
