"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Plan 46 — global hamburger drawer. Exposed in both desktop header + mobile
 * overflow row. Groups every page a signed-in user (or public viewer) might
 * want to reach. Groups hide automatically based on viewer role +
 * authentication state.
 *
 * Keyboard:
 * - ESC closes the drawer
 * - Focus is trapped inside while open
 * - Focus restores to the triggering button on close
 */

type LinkRow = { href: string; label: string };
type Group = { key: string; label: string; links: LinkRow[] };

const PUBLIC_LINKS: LinkRow[] = [
  { href: "/", label: "Home" },
  { href: "/fixtures", label: "Fixtures" },
  { href: "/standings", label: "Standings" },
  { href: "/players", label: "Players" },
  { href: "/announcements", label: "News" },
  { href: "/punishments", label: "Discipline" },
];

const PLAYER_LINKS: LinkRow[] = [
  { href: "/player/squad", label: "Squad" },
  { href: "/player/profile", label: "Profile" },
  { href: "/player/appeals", label: "Appeals" },
  { href: "/player/disputes", label: "Disputes" },
];

const STAFF_LINKS: LinkRow[] = [
  { href: "/admin", label: "Site Manager" },
  { href: "/admin/branding", label: "Branding" },
  { href: "/admin/players", label: "Players" },
  { href: "/admin/match-days", label: "Match Days" },
  { href: "/admin/squads", label: "Squads" },
  { href: "/admin/broadcast", label: "Broadcast" },
  { href: "/admin/broadcast/stingers", label: "Stingers" },
  { href: "/admin/youtube-channels", label: "YouTube Channels" },
  { href: "/admin/punishments", label: "Punishments" },
  { href: "/admin/stats-review", label: "Stats Review" },
  { href: "/admin/appeals", label: "Appeals" },
  { href: "/admin/disputes", label: "Disputes" },
  { href: "/admin/orgs", label: "Orgs" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/roles", label: "Roles" },
  { href: "/admin/announcements", label: "Announcements" },
  { href: "/admin/security/sessions", label: "Sessions" },
  { href: "/admin/trash", label: "Trash" },
];

const REFEREE_LINKS: LinkRow[] = [
  { href: "/referee/attendance", label: "Attendance" },
];

export type NavDrawerProps = {
  open: boolean;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  roles: readonly string[];
  isStaff: boolean;
  authenticated: boolean;
};

export function NavDrawer({
  open,
  onClose,
  triggerRef,
  roles,
  isStaff,
  authenticated,
}: NavDrawerProps) {
  const pathname = usePathname() ?? "/";
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  const groups: Group[] = [];
  groups.push({ key: "public", label: "Public", links: PUBLIC_LINKS });
  if (authenticated && roles.includes("player")) {
    groups.push({ key: "player", label: "Player", links: PLAYER_LINKS });
  }
  if (isStaff) {
    groups.push({ key: "staff", label: "Staff", links: STAFF_LINKS });
  }
  if (roles.includes("referee") || roles.includes("admin") || roles.includes("moderator")) {
    groups.push({ key: "referee", label: "Referee", links: REFEREE_LINKS });
  }

  // Close on ESC. Register only when open.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Restore focus when closing. Track whether the drawer was previously
  // open so we only steal focus on an actual open→closed transition
  // (avoids grabbing focus on initial mount or while the user is elsewhere).
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      return;
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      triggerRef.current?.focus();
    }
  }, [open, triggerRef]);

  // Focus trap: when drawer opens, focus the first link. Tab + Shift+Tab
  // wrap inside the panel.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    // Focus the first actionable element.
    const first = focusables()[0];
    first?.focus();

    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    panel.addEventListener("keydown", trap);
    return () => panel.removeEventListener("keydown", trap);
  }, [open]);

  // Always mount the drawer + backdrop so CSS transforms can animate the
  // slide-in / slide-out. The `open` flag flips the translate-x + opacity
  // classes; pointer-events are muted when closed so clicks fall through
  // to the underlying page.
  //
  // The drawer is portalled to document.body so the sticky-header
  // `backdrop-filter` (which creates a new containing block) cannot clip
  // `position: fixed`. Without the portal the drawer would only span the
  // header band — user saw that bug on the first ship and asked for the
  // full-height slide from the right side.
  //
  // Hydration: createPortal renders outside the React tree so the server-
  // rendered HTML never contains the portal subtree. Gate the portal on
  // a post-mount flag so client-side hydration matches the server's
  // "nothing here" output first, THEN inserts the portal on the next tick.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div role="presentation" data-testid="nav-drawer-shell">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        aria-hidden={!open}
        tabIndex={open ? 0 : -1}
        className={
          "fixed inset-0 z-[119] bg-black/60 backdrop-blur-sm transition-opacity duration-300 ease-out " +
          (open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none")
        }
        data-testid="nav-drawer-backdrop"
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        aria-labelledby={titleId}
        className={
          "fixed inset-y-0 left-0 z-[120] flex w-[min(320px,85vw)] flex-col overflow-y-auto border-r border-[var(--ink-4)] bg-[var(--ink-0)] shadow-[25px_0_60px_-20px_rgba(0,0,0,0.9)] transform transition-transform duration-300 ease-out " +
          (open ? "translate-x-0" : "-translate-x-full pointer-events-none")
        }
        data-testid="nav-drawer"
      >
        <div className="flex items-center justify-between border-b border-[var(--ink-4)] px-5 py-4">
          <span
            id={titleId}
            className="font-display text-sm font-bold uppercase tracking-[0.22em] text-[var(--chalk-0)]"
          >
            Menu
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-transparent text-[var(--chalk-2)] hover:border-[var(--ink-4)] hover:text-[var(--chalk-0)]"
            data-testid="nav-drawer-close"
          >
            <svg
              aria-hidden
              viewBox="0 0 20 20"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="square" />
            </svg>
          </button>
        </div>
        <div className="flex-1 space-y-6 px-5 py-5">
          {groups.map((group) => (
            <section
              key={group.key}
              data-testid={`nav-drawer-group-${group.key}`}
            >
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--chalk-3)]">
                {group.label}
              </div>
              <ul className="space-y-0.5">
                {group.links.map((link) => {
                  const active =
                    link.href === "/"
                      ? pathname === "/"
                      : pathname === link.href ||
                        pathname.startsWith(link.href + "/");
                  return (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        onClick={onClose}
                        data-testid={`nav-drawer-link-${link.href}`}
                        aria-current={active ? "page" : undefined}
                        className={
                          "nav-drawer-link block rounded-sm px-3 py-2 text-sm font-medium transition-colors " +
                          (active
                            ? "bg-[var(--signal)] text-[var(--signal-ink)]"
                            : "text-[var(--chalk-1)] hover:bg-[var(--ink-3)] hover:text-[var(--chalk-0)]")
                        }
                      >
                        {link.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

/**
 * Icon-only hamburger trigger. Exposes a ref so the drawer can restore focus
 * on close. The parent owns the open state and wires onClick to a toggler.
 */
export function HamburgerButton({
  buttonRef,
  open,
  onClick,
  className,
}: {
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  open: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label="Menu"
      aria-expanded={open}
      aria-controls="nav-drawer"
      onClick={onClick}
      data-testid="nav-drawer-trigger"
      className={
        "inline-flex h-9 w-9 items-center justify-center rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] text-[var(--chalk-1)] transition-colors hover:border-[var(--signal)] hover:text-[var(--chalk-0)] " +
        (className ?? "")
      }
    >
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="square" />
      </svg>
    </button>
  );
}

/**
 * Stateful wrapper that owns `open` + the trigger ref. Convenient for the
 * SiteChromeClient mount points (desktop header + mobile row).
 */
export function HamburgerNav({
  roles,
  isStaff,
  authenticated,
  className,
}: {
  roles: readonly string[];
  isStaff: boolean;
  authenticated: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <>
      <HamburgerButton
        buttonRef={triggerRef}
        open={open}
        onClick={toggle}
        className={className}
      />
      <NavDrawer
        open={open}
        onClose={close}
        triggerRef={triggerRef}
        roles={roles}
        isStaff={isStaff}
        authenticated={authenticated}
      />
    </>
  );
}
