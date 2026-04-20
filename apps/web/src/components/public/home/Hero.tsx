import Link from "next/link";

type Props = {
  seasonYearRange: string | null;
  divisionName: string | null;
};

/**
 * Homepage hero. Large display treatment of the CADE wordmark with a
 * ticker-stripe accent panel. Live-season pulse is a quiet brag — this
 * is an active competition, not a static page.
 */
export function Hero({ seasonYearRange, divisionName }: Props) {
  return (
    <section className="relative overflow-hidden border-b border-[var(--ink-4)]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 scanlines opacity-40"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 top-1/3 h-96 w-96 rounded-full bg-[var(--signal-glow)] blur-[120px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-[var(--signal-glow)] opacity-60 blur-[120px]"
      />

      <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-16 md:pb-20 md:pt-20">
        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.28em]">
          <span className="inline-flex items-center gap-2 text-[var(--signal)]">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full bg-[var(--signal)] pulse-dot"
            />
            Live season
          </span>
          <span aria-hidden className="h-[1px] w-6 bg-[var(--ink-5)]" />
          <span className="text-[var(--chalk-2)]">
            {divisionName ?? "Division 1 Elite"}
          </span>
          <span aria-hidden className="h-[1px] w-6 bg-[var(--ink-5)]" />
          <span className="tabular text-[var(--chalk-1)]">
            {seasonYearRange ?? "2025 / 2026"}
          </span>
        </div>

        {/* Wordmark */}
        <div className="mt-8 grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
          <h1 className="font-display text-[clamp(3.2rem,9vw,6.5rem)] font-bold leading-[0.9] tracking-tight text-[var(--chalk-0)]">
            <span className="block">
              CADE
              <span
                aria-hidden
                className="ml-3 inline-block h-[0.55em] w-[0.55em] translate-y-[-0.12em] rounded-[4px] bg-[var(--signal)] shadow-[0_0_30px_-4px_var(--signal-glow)]"
              />
            </span>
            <span className="relative block pr-2">
              <span className="relative z-10">LEAGUE</span>
              <span
                aria-hidden
                className="absolute inset-y-2 left-0 right-0 origin-left bg-[repeating-linear-gradient(135deg,rgba(0,255,136,0.18)_0_4px,transparent_4px_12px)]"
              />
            </span>
          </h1>

          {/* Spec plate — stadium ID tag vibe */}
          <aside className="relative self-stretch overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-5 md:max-w-xs">
            <div
              aria-hidden
              className="absolute left-0 top-0 h-full w-1 bg-[var(--signal)]"
            />
            <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--chalk-3)]">
              Fixture&nbsp;// Identifier
            </div>
            <div className="mt-2 font-display text-lg font-bold leading-tight text-[var(--chalk-0)]">
              Elite eFootball · PS5
            </div>
            <dl className="mt-4 space-y-2 text-xs">
              <MetaRow label="Format" value="Round robin + playoffs" />
              <MetaRow label="Roster" value="13 competitors" />
              <MetaRow label="Region" value="Lagos, NG · WAT" />
            </dl>
          </aside>
        </div>

        {/* Tagline + CTA */}
        <div className="mt-10 flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
          <p className="max-w-2xl text-base leading-relaxed text-[var(--chalk-2)]">
            Nigeria&apos;s elite controller-based football league. One division.
            Thirteen names. Every goal, card, and tiebreaker tracked from pitch
            to podium — live for the 2025–2026 season.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/fixtures"
              className="inline-flex items-center gap-2 rounded-sm bg-[var(--signal)] px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-[var(--signal-ink)] transition-transform hover:-translate-y-0.5"
            >
              Fixture list
              <span aria-hidden>↗</span>
            </Link>
            <Link
              href="/standings"
              className="inline-flex items-center gap-2 rounded-sm border border-[var(--ink-5)] px-5 py-3 text-sm font-bold uppercase tracking-[0.14em] text-[var(--chalk-0)] transition-colors hover:border-[var(--signal)] hover:text-[var(--signal)]"
            >
              Standings
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--chalk-3)]">
        {label}
      </dt>
      <dd className="text-right text-[13px] font-medium text-[var(--chalk-1)]">
        {value}
      </dd>
    </div>
  );
}
