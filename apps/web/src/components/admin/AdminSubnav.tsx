"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_HUBS, findHubByPath } from "@/lib/admin-nav";

/**
 * AdminSubnav renders the cross-console hub strip. Active hub is
 * highlighted with a signal-green underline + chalk-0 label, others fade
 * to chalk-2. Rendered client-side so `usePathname` determines active
 * state without server-round-trip.
 *
 * UI Audit Slice 4 (2026-04-28) — collapsed from 16 hard-coded tabs to
 * the 8 hubs in `lib/admin-nav.ts`. Visibility is pre-resolved by the
 * parent layout against `hasPermAsync` and passed as `visibleHubs`
 * (list of hub keys). Omit the prop to show every hub (back-compat for
 * callers that haven't wired perms yet; admin wildcard makes this a
 * no-op in practice).
 */

export function AdminSubnav({
  visibleHubs,
}: {
  visibleHubs?: readonly string[];
}) {
  const pathname = usePathname() ?? "/admin";
  const allowed = visibleHubs ? new Set(visibleHubs) : null;
  const hubs = allowed
    ? ADMIN_HUBS.filter((h) => allowed.has(h.key))
    : ADMIN_HUBS;
  const activeHub = findHubByPath(pathname);
  const onDashboard = pathname === "/admin";

  return (
    <nav
      aria-label="Admin sections"
      className="flex flex-wrap items-center gap-1 border-b border-[var(--ink-4)] bg-[var(--ink-1)]/80 px-1 pt-1"
      data-testid="admin-subnav"
    >
      <Link
        href="/admin"
        className={
          "relative px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] transition-colors " +
          (onDashboard
            ? "text-[var(--chalk-0)]"
            : "text-[var(--chalk-3)] hover:text-[var(--chalk-0)]")
        }
        aria-current={onDashboard ? "page" : undefined}
        data-testid="admin-subnav-tab-dashboard"
      >
        Dashboard
        <span
          aria-hidden
          className={
            "pointer-events-none absolute inset-x-3 -bottom-[1px] h-[2px] transition-all " +
            (onDashboard ? "bg-[var(--signal)]" : "bg-transparent")
          }
        />
      </Link>
      {hubs.map((hub) => {
        const active = activeHub?.key === hub.key;
        return (
          <Link
            key={hub.key}
            href={hub.href}
            className={
              "relative px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] transition-colors " +
              (active
                ? "text-[var(--chalk-0)]"
                : "text-[var(--chalk-3)] hover:text-[var(--chalk-0)]")
            }
            aria-current={active ? "page" : undefined}
            data-testid={`admin-subnav-tab-${hub.key}`}
          >
            {hub.label}
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
