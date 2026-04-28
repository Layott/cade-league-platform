"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { findHubByPath, findSubtabByPath } from "@/lib/admin-nav";

/**
 * UI Audit Slice 4 (2026-04-28) — breadcrumb strip for admin hub pages.
 *
 * Format: Admin / <Hub label> / <Subtab label> [/ <Detail>]
 *
 * Resolves the hub + subtab from `usePathname()` against `ADMIN_HUBS`.
 * The optional `detail` slot is used by deep pages (e.g. punishment
 * editor showing the player name) — passed by the page that knows the
 * dynamic context.
 */

export function Breadcrumbs({
  detail,
}: {
  /** Optional 4th-level label, e.g. "Edit · ADEFOLA" on a player edit page. */
  detail?: string;
}) {
  const pathname = usePathname() ?? "";
  const hub = findHubByPath(pathname);
  const subtab = hub ? findSubtabByPath(hub, pathname) : null;

  // /admin (the dashboard) renders no breadcrumbs — the page itself is the root.
  if (!hub) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      data-testid="admin-breadcrumbs"
      className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--chalk-3)]"
    >
      <Link
        href="/admin"
        className="hover:text-[var(--signal)] transition-colors"
        data-testid="admin-breadcrumbs-root"
      >
        Admin
      </Link>
      <Separator />
      {detail || subtab ? (
        <>
          <Link
            href={hub.href}
            className="hover:text-[var(--signal)] transition-colors"
            data-testid={`admin-breadcrumbs-hub-${hub.key}`}
          >
            {hub.label}
          </Link>
          {subtab ? (
            <>
              <Separator />
              {detail ? (
                <Link
                  href={subtab.href}
                  className="hover:text-[var(--signal)] transition-colors"
                  data-testid={`admin-breadcrumbs-subtab-${subtab.key}`}
                >
                  {subtab.label}
                </Link>
              ) : (
                <span
                  aria-current="page"
                  className="text-[var(--chalk-0)]"
                  data-testid={`admin-breadcrumbs-subtab-${subtab.key}`}
                >
                  {subtab.label}
                </span>
              )}
            </>
          ) : null}
          {detail ? (
            <>
              <Separator />
              <span
                aria-current="page"
                className="text-[var(--chalk-0)]"
                data-testid="admin-breadcrumbs-detail"
              >
                {detail}
              </span>
            </>
          ) : null}
        </>
      ) : (
        <span
          aria-current="page"
          className="text-[var(--chalk-0)]"
          data-testid={`admin-breadcrumbs-hub-${hub.key}`}
        >
          {hub.label}
        </span>
      )}
    </nav>
  );
}

function Separator() {
  return (
    <span aria-hidden className="text-[var(--chalk-4)]">
      /
    </span>
  );
}
