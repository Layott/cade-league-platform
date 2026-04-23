import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { PARTNER_LOGOS, PRIMARY_LOGOS } from "@/lib/brand";

/**
 * /welcome — sign-in landing for unauthenticated visitors.
 *
 * Middleware redirects any anonymous visitor hitting `/` to `/welcome`.
 * Authenticated viewers keep seeing the full public homepage at `/`. The
 * "Public site" link forwards to `/?nolanding=1` to bypass that redirect
 * when a signed-out reader explicitly wants to browse fixtures/standings.
 *
 * Chrome (nav drawer + bell + footer) is hidden for this route via the
 * HIDDEN_PREFIXES list in SiteChromeClient so the landing reads like a
 * single bold surface, not just another public page.
 */

export const metadata: Metadata = {
  title: "Welcome — CADE League",
  description:
    "CADE Esports League sign-in. Division 1 Elite — 2025/2026 season.",
};

export default function WelcomePage() {
  return (
    <main
      className="relative flex min-h-screen w-full flex-col overflow-hidden"
      style={{ background: "var(--ink-0)" }}
      data-testid="welcome-page"
    >
      {/* Dual-tone radial wash — green primary + pink secondary glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 18% 10%, rgba(107,205,6,0.16) 0%, transparent 55%), radial-gradient(circle at 85% 90%, rgba(254,3,109,0.18) 0%, transparent 55%)",
        }}
      />
      {/* Animated grid texture */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 welcome-grid"
      />
      {/* Scanlines */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "repeating-linear-gradient(180deg, rgba(255,255,255,0.022) 0px, rgba(255,255,255,0.022) 1px, transparent 1px, transparent 4px)",
        }}
      />

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-6 py-12">
        {/* CADE + GameEvo logos with pink glow */}
        <div
          className="relative flex items-center justify-center gap-8"
          data-testid="welcome-logos"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute -inset-16 rounded-full blur-[80px]"
            style={{
              background:
                "radial-gradient(circle at 40% 50%, rgba(254,3,109,0.35) 0%, rgba(254,3,109,0.08) 45%, transparent 70%)",
            }}
          />
          <Image
            src={PRIMARY_LOGOS.cade}
            alt="CADE esports"
            width={110}
            height={110}
            priority
            className="relative z-10 h-[96px] w-[96px] md:h-[110px] md:w-[110px]"
            style={{ objectFit: "contain" }}
          />
          <span
            aria-hidden
            className="relative z-10 h-16 w-px bg-gradient-to-b from-transparent via-[rgba(254,3,109,0.6)] to-transparent md:h-20"
          />
          <Image
            src={PRIMARY_LOGOS.gameevoWhite}
            alt="GameEvo"
            width={160}
            height={110}
            priority
            className="relative z-10 h-[72px] w-auto md:h-[90px]"
            style={{ objectFit: "contain" }}
          />
        </div>

        {/* Sign-in card */}
        <section
          className="mt-12 w-full max-w-md"
          aria-labelledby="welcome-heading"
          style={{
            background: "rgba(11,12,16,0.85)",
            border: "1px solid var(--ink-3)",
            borderRadius: 6,
            backdropFilter: "blur(16px)",
            boxShadow:
              "0 30px 80px -28px rgba(0,0,0,0.75), 0 0 0 1px rgba(107,205,6,0.06) inset",
          }}
        >
          <div className="px-8 pt-8 text-center">
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.3em]"
              style={{ color: "var(--secondary)" }}
            >
              CADE Esports League
            </div>
            <h1
              id="welcome-heading"
              className="mt-3 font-broadcast-display text-[32px] leading-[1] text-[var(--chalk-0)] md:text-[38px]"
            >
              Welcome back.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-[var(--chalk-2)]">
              Division 1 Elite — 2025/2026 season.
            </p>
          </div>
          <div className="space-y-3 px-8 pb-8 pt-7">
            <Link
              href="/login"
              data-testid="welcome-signin"
              className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-sm bg-[var(--primary)] px-5 py-3 text-sm font-bold uppercase tracking-[0.18em] text-[var(--primary-ink)] transition-transform hover:-translate-y-0.5"
              style={{
                borderTop: "2px solid var(--secondary)",
                boxShadow:
                  "0 12px 32px -10px rgba(107,205,6,0.5), 0 0 0 1px rgba(107,205,6,0.35)",
              }}
            >
              <span>Sign in</span>
              <span aria-hidden className="transition-transform group-hover:translate-x-1">
                →
              </span>
            </Link>
            <Link
              href="/?nolanding=1"
              data-testid="welcome-public-link"
              className="flex w-full items-center justify-center gap-2 rounded-sm border border-[var(--ink-4)] bg-transparent px-5 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--chalk-1)] transition-colors hover:border-[var(--secondary)] hover:text-[var(--secondary)]"
            >
              Public site
              <span aria-hidden>↗</span>
            </Link>
          </div>
        </section>
      </div>

      {/* Partner strip */}
      <div
        className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center px-6 pb-10 pt-4"
        data-testid="welcome-partners"
      >
        <div
          className="mb-3 text-[10px] font-semibold uppercase tracking-[0.28em]"
          style={{ color: "var(--chalk-3)" }}
        >
          Broadcast partners
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4 opacity-85">
          <Image
            src={PARTNER_LOGOS.gamepride}
            alt="Gamepride"
            width={120}
            height={36}
            className="h-8 w-auto object-contain md:h-10"
          />
          <Image
            src={PARTNER_LOGOS.traceTv}
            alt="Trace TV"
            width={120}
            height={36}
            className="h-8 w-auto object-contain md:h-10"
          />
          <Image
            src={PARTNER_LOGOS.esportsAfricaNewsWhite}
            alt="Esports Africa News"
            width={140}
            height={36}
            className="h-8 w-auto object-contain md:h-10"
          />
        </div>
      </div>
    </main>
  );
}
