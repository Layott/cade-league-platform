"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";

/**
 * SiteChrome wraps every route with the public-facing nav + footer.
 * It hides itself on admin + auth + logout routes — those have their own
 * chrome. This keeps the root layout as a single mount point so global
 * fonts and CSS variables propagate consistently.
 */
const HIDDEN_PREFIXES = ["/admin", "/login", "/logout"];

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/fixtures", label: "Fixtures" },
  { href: "/standings", label: "Standings" },
  { href: "/players", label: "Players" },
  { href: "/announcements", label: "News" },
  { href: "/punishments", label: "Discipline" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function SiteChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const hidden = HIDDEN_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  if (hidden) return <>{children}</>;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader pathname={pathname} />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}

function SiteHeader({ pathname }: { pathname: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--ink-4)] bg-[rgba(7,8,11,0.82)] backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-5 py-3">
        <Link
          href="/"
          className="group flex items-center gap-3"
          aria-label="CADE League home"
        >
          <CadeMark />
          <div className="flex flex-col leading-none">
            <span className="font-display text-base font-bold tracking-tight text-[var(--chalk-0)]">
              CADE&nbsp;League
            </span>
            <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
              Division&nbsp;1&nbsp;Elite
            </span>
          </div>
        </Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {NAV_LINKS.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={
                  "relative px-3 py-2 text-sm font-medium tracking-wide transition-colors " +
                  (active
                    ? "text-[var(--chalk-0)]"
                    : "text-[var(--chalk-2)] hover:text-[var(--chalk-0)]")
                }
              >
                {link.label}
                {active ? (
                  <span
                    aria-hidden
                    className="absolute inset-x-3 -bottom-[1px] h-[2px] bg-[var(--signal)]"
                  />
                ) : null}
              </Link>
            );
          })}
        </nav>
        <Link
          href="/login"
          className="inline-flex items-center gap-2 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-[var(--chalk-1)] transition-colors hover:border-[var(--signal)] hover:text-[var(--signal)]"
        >
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full bg-[var(--signal)] pulse-dot"
          />
          Staff
        </Link>
      </div>
      {/* Mobile nav row */}
      <nav
        className="mx-auto flex max-w-6xl gap-1 overflow-x-auto border-t border-[var(--ink-4)] px-3 py-2 md:hidden"
        aria-label="Primary (mobile)"
      >
        {NAV_LINKS.map((link) => {
          const active = isActive(pathname, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={
                "whitespace-nowrap rounded-sm px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] transition-colors " +
                (active
                  ? "bg-[var(--signal)] text-[var(--signal-ink)]"
                  : "text-[var(--chalk-2)] hover:bg-[var(--ink-3)] hover:text-[var(--chalk-0)]")
              }
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-[var(--ink-4)] bg-[var(--ink-0)]">
      <div className="mx-auto max-w-6xl px-5 py-8">
        <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <CadeMark small />
            <div className="leading-tight">
              <div className="font-display text-sm font-bold text-[var(--chalk-0)]">
                CADE Esports League
              </div>
              <div className="text-xs text-[var(--chalk-3)]">
                Division 1 Elite · Season 2025–2026 · Lagos, NG
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-[var(--chalk-3)]">
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full bg-[var(--signal)] pulse-dot"
              />
              Live season
            </span>
            <span className="hidden h-3 w-px bg-[var(--ink-4)] sm:inline-block" />
            <span>Built for matchday.</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

function CadeMark({ small = false }: { small?: boolean }) {
  const size = small ? 26 : 32;
  return (
    <span
      aria-hidden
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 32 32"
        width={size}
        height={size}
        className="block"
      >
        <rect x="1" y="1" width="30" height="30" rx="3" fill="#000" />
        <rect
          x="1"
          y="1"
          width="30"
          height="30"
          rx="3"
          fill="none"
          stroke="var(--signal)"
          strokeWidth="1.5"
        />
        {/* C-shaped mark (CADE monogram abstraction) */}
        <path
          d="M22 9 Q13 9 13 16 Q13 23 22 23"
          fill="none"
          stroke="var(--signal)"
          strokeWidth="2.4"
          strokeLinecap="square"
        />
        <rect
          x="22"
          y="14"
          width="3"
          height="4"
          fill="var(--signal)"
        />
      </svg>
    </span>
  );
}
