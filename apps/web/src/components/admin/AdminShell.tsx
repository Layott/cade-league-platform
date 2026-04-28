import Link from "next/link";
import type { ReactNode } from "react";
import { AdminSubnav } from "./AdminSubnav";

/**
 * AdminShell is the thin wrapper around every /admin/* page. It renders:
 *   - a "← Back to site" return link (muted chalk-3)
 *   - eyebrow tag "ADMIN CONSOLE" in signal green
 *   - the AdminSubnav hub strip
 *   - a full-width dark content surface
 *
 * The global SiteChrome already handles the primary header + bell +
 * log-out, so this shell intentionally stays compact — no duplicate
 * header chrome.
 *
 * UI Audit Slice 4 (2026-04-28) — `visibleHubs` is the list of hub
 * keys the viewer is allowed to see (resolved by the layout from
 * ADMIN_HUBS perms).
 */

export function AdminShell({
  children,
  visibleHubs,
}: {
  children: ReactNode;
  visibleHubs?: readonly string[];
}) {
  return (
    <div className="min-h-screen bg-[var(--ink-1)]">
      <div className="mx-auto w-full max-w-6xl px-5 pt-6">
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)] transition-colors hover:text-[var(--signal)]"
          >
            <span aria-hidden>←</span> Back to site
          </Link>
          <span
            className="inline-flex items-center gap-2 rounded-sm border border-[rgba(107,205,6,0.3)] bg-[rgba(107,205,6,0.06)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--primary)]"
            aria-label="Admin console"
          >
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full bg-[var(--signal)] pulse-dot"
            />
            Admin console
          </span>
        </div>
        <div className="mt-4">
          <AdminSubnav visibleHubs={visibleHubs} />
        </div>
      </div>
      <main className="mx-auto w-full max-w-6xl px-5 py-8">{children}</main>
    </div>
  );
}
