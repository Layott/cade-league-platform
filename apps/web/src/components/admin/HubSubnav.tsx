"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AdminHub, AdminSubtab } from "@/lib/admin-nav";
import { findSubtabByPath } from "@/lib/admin-nav";

/**
 * UI Audit Slice 4 (2026-04-28) — generic sub-tab strip rendered inside
 * each hub layout. Replaces per-hub bespoke `*Tabs.tsx` components
 * (TournamentTabs, BroadcastHubTabs, TrashTabs).
 *
 * Active state is computed via `findSubtabByPath`; longer path matches
 * win first so /admin/people/security/sessions hits the sessions subtab,
 * not the bare hub URL.
 */

export function HubSubnav({
  hub,
  visibleSubtabs,
}: {
  hub: AdminHub;
  visibleSubtabs?: readonly AdminSubtab[];
}) {
  const pathname = usePathname() ?? hub.href;
  const subtabs = visibleSubtabs ?? hub.subtabs ?? [];
  if (!subtabs.length) return null;

  const active = findSubtabByPath(hub, pathname);

  return (
    <nav
      aria-label={`${hub.label} sections`}
      className="flex flex-wrap items-center gap-1 border-b border-[var(--ink-4)] bg-[var(--ink-1)]/80 px-1 pt-1"
      data-testid={`hub-subnav-${hub.key}`}
    >
      {subtabs.map((tab) => {
        const isActive = active?.key === tab.key;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            className={
              "relative px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] transition-colors " +
              (isActive
                ? "text-[var(--chalk-0)]"
                : "text-[var(--chalk-3)] hover:text-[var(--chalk-0)]")
            }
            aria-current={isActive ? "page" : undefined}
            data-testid={`hub-subnav-tab-${tab.key}`}
          >
            {tab.label}
            <span
              aria-hidden
              className={
                "pointer-events-none absolute inset-x-3 -bottom-[1px] h-[2px] transition-all " +
                (isActive ? "bg-[var(--signal)]" : "bg-transparent")
              }
            />
          </Link>
        );
      })}
    </nav>
  );
}
