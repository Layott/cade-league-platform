"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * UI Audit Slice 3 (2026-04-28) — sub-tab strip that lives inside the
 * broadcast v2 layout. Producer-team UX: Sessions stays first.
 *
 * Active state matches the segment after `/admin/broadcast/v2/`. The
 * bare `/admin/broadcast/v2` (and its `[sessionId]` deep-link) light up
 * the Sessions tab so a producer in the control room still knows where
 * they are.
 */

const TABS: Array<{ href: string; label: string; segment: string }> = [
  { href: "/admin/broadcast/v2", label: "Sessions", segment: "" },
  { href: "/admin/broadcast/v2/stingers", label: "Stingers", segment: "stingers" },
  { href: "/admin/broadcast/v2/branding", label: "Branding", segment: "branding" },
  { href: "/admin/broadcast/v2/youtube", label: "YouTube", segment: "youtube" },
];

function activeSegment(pathname: string): string {
  // Strip the /admin/broadcast/v2 prefix; the next path segment is the
  // sub-tab key. Anything that's not "stingers" / "branding" / "youtube"
  // (including the bare path and dynamic /[sessionId] routes) maps to
  // Sessions.
  const stripped = pathname.replace(/^\/admin\/broadcast\/v2/, "");
  if (!stripped || stripped === "/") return "";
  const next = stripped.split("/").filter(Boolean)[0] ?? "";
  if (next === "stingers" || next === "branding" || next === "youtube") {
    return next;
  }
  return "";
}

export function BroadcastHubTabs() {
  const pathname = usePathname() ?? "/admin/broadcast/v2";
  const active = activeSegment(pathname);
  return (
    <nav
      aria-label="Broadcast hub sections"
      className="flex flex-wrap items-center gap-1 border-b border-[var(--ink-4)] bg-[var(--ink-1)]/80 px-1 pt-1"
      data-testid="broadcast-hub-tabs"
    >
      {TABS.map((tab) => {
        const isActive = tab.segment === active;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={
              "relative px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] transition-colors " +
              (isActive
                ? "text-[var(--chalk-0)]"
                : "text-[var(--chalk-3)] hover:text-[var(--chalk-0)]")
            }
            aria-current={isActive ? "page" : undefined}
            data-testid={`broadcast-hub-tab-${tab.segment || "sessions"}`}
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
