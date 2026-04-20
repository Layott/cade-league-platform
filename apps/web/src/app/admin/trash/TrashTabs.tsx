"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TRASH_ENTITIES, TRASH_ENTITY_KEYS } from "@/server/trash/entities";

/**
 * Pill-style tabs for the /admin/trash/[entity] pages. Matches
 * AdminSubnav tone so the nested nav reads consistently with the
 * console chrome above it.
 */
export function TrashTabs() {
  const pathname = usePathname() ?? "";
  return (
    <nav
      aria-label="Trash entity types"
      className="flex flex-wrap gap-1.5 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-1"
    >
      {TRASH_ENTITY_KEYS.map((key) => {
        const href = `/admin/trash/${key}`;
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={key}
            href={href}
            className={
              "whitespace-nowrap rounded-sm px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors " +
              (active
                ? "bg-[var(--signal)] text-[var(--signal-ink)]"
                : "text-[var(--chalk-2)] hover:bg-[var(--ink-3)] hover:text-[var(--chalk-0)]")
            }
            aria-current={active ? "page" : undefined}
          >
            {TRASH_ENTITIES[key].label}
          </Link>
        );
      })}
    </nav>
  );
}
