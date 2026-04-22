"use client";

import Link from "next/link";
import { highestRole, type PrecedenceRole } from "@/lib/role-precedence";

/**
 * Plan 40 P40-A — UserBadgeShell
 *
 * Client child of the server-side `<UserBadge />`. Receives a
 * pre-resolved prop bag (no DB access) and renders:
 *
 *   1. a compact chip-style button with the user's avatar, display name,
 *      and a role-chip for the highest-precedence role
 *   2. a native `<details>` popover listing "Profile" → `/profile`
 *      and a "Sign out" form POST → `/logout`
 *
 * Native `<details>` keeps the component dependency-free and gives us
 * free keyboard (Enter/Space toggle) + focus semantics. The chevron
 * rotates via `group-open:` Tailwind variant.
 *
 * Role chip palette — Plan 40 spec §6:
 *   admin            → signal-green
 *   loc / idc        → secondary pink
 *   referee          → amber
 *   player           → chalk-2
 *   viewer           → chalk-3 (fallback — no --chalk-4 token exists)
 *   everything else  → chalk-3
 */

export type UserBadgeShellProps = {
  displayName: string;
  photoUrl: string | null;
  roles: readonly string[];
};

type ChipStyle = {
  bg: string;
  border: string;
  text: string;
};

function chipStyle(role: PrecedenceRole | null): ChipStyle {
  switch (role) {
    case "admin":
      return {
        bg: "bg-[rgba(107,205,6,0.12)]",
        border: "border-[rgba(107,205,6,0.45)]",
        text: "text-[var(--primary)]",
      };
    case "loc":
    case "idc":
      return {
        bg: "bg-[rgba(254,3,109,0.12)]",
        border: "border-[rgba(254,3,109,0.45)]",
        text: "text-[var(--secondary)]",
      };
    case "referee":
      return {
        bg: "bg-[rgba(255,176,32,0.12)]",
        border: "border-[rgba(255,176,32,0.45)]",
        text: "text-[var(--amber)]",
      };
    case "player":
      return {
        bg: "bg-[var(--ink-2)]",
        border: "border-[var(--ink-4)]",
        text: "text-[var(--chalk-2)]",
      };
    default:
      return {
        bg: "bg-[var(--ink-2)]",
        border: "border-[var(--ink-4)]",
        text: "text-[var(--chalk-3)]",
      };
  }
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function humanizeRole(role: string): string {
  if (role === "loc") return "LOC";
  if (role === "idc") return "IDC";
  if (role === "team_manager") return "Team Mgr";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function UserBadgeShell({
  displayName,
  photoUrl,
  roles,
}: UserBadgeShellProps) {
  const top = highestRole(roles);
  const chip = chipStyle(top);
  const initials = initialsFromName(displayName);

  return (
    <details className="group relative" data-testid="user-badge">
      <summary
        className="flex cursor-pointer list-none items-center gap-2 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-2 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--chalk-1)] transition-colors hover:border-[var(--signal)] [&::-webkit-details-marker]:hidden"
        aria-label={`Signed in as ${displayName}`}
      >
        <Avatar photoUrl={photoUrl} initials={initials} />
        <span className="hidden max-w-[10rem] truncate text-[var(--chalk-0)] sm:inline">
          {displayName}
        </span>
        {top ? (
          <span
            className={
              "inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] " +
              `${chip.bg} ${chip.border} ${chip.text}`
            }
            data-testid="user-badge-role-chip"
          >
            {humanizeRole(top)}
          </span>
        ) : null}
        <Chevron />
      </summary>

      <div
        className="absolute right-0 mt-1 w-56 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] shadow-lg"
        role="menu"
      >
        <div className="border-b border-[var(--ink-4)] px-3 py-2">
          <div className="truncate text-sm font-semibold text-[var(--chalk-0)]">
            {displayName}
          </div>
          {roles.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {roles.map((r) => (
                <span
                  key={r}
                  className="inline-flex items-center rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--chalk-2)]"
                >
                  {humanizeRole(r)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <Link
          href="/profile"
          role="menuitem"
          className="block px-3 py-2 text-sm text-[var(--chalk-1)] transition-colors hover:bg-[var(--ink-2)] hover:text-[var(--chalk-0)]"
          data-testid="user-badge-profile-link"
        >
          Profile
        </Link>
        <form action="/logout" method="post" className="m-0">
          <button
            type="submit"
            role="menuitem"
            className="block w-full border-t border-[var(--ink-4)] px-3 py-2 text-left text-sm text-[var(--chalk-2)] transition-colors hover:bg-[var(--ink-2)] hover:text-[var(--flare)]"
            data-testid="user-badge-sign-out"
          >
            Sign out
          </button>
        </form>
      </div>
    </details>
  );
}

function Avatar({
  photoUrl,
  initials,
}: {
  photoUrl: string | null;
  initials: string;
}) {
  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt=""
        width={24}
        height={24}
        className="h-6 w-6 rounded-full border border-[var(--ink-4)] object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--ink-4)] bg-[var(--ink-3)] text-[10px] font-bold tracking-wider text-[var(--chalk-1)]"
    >
      {initials}
    </span>
  );
}

function Chevron() {
  return (
    <svg
      aria-hidden
      width="10"
      height="10"
      viewBox="0 0 10 10"
      className="text-[var(--chalk-3)] transition-transform group-open:rotate-180"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 4l3 3 3-3" />
    </svg>
  );
}
