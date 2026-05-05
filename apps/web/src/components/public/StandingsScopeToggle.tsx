import Link from "next/link";

export type StandingsScope = "cumulative" | "week-only" | "matchday-only";

export function StandingsScopeToggle({
  matchDayNumber,
  active,
}: {
  matchDayNumber: number;
  active: StandingsScope;
}) {
  const cumulativeHref = `/standings/matchday/${matchDayNumber}`;
  const weekHref = `/standings/matchday/${matchDayNumber}?view=week-only`;
  const onlyHref = `/standings/matchday/${matchDayNumber}?view=md-only`;
  return (
    <div
      role="tablist"
      aria-label="Standings scope"
      data-testid="scope-toggle"
      className="mb-4 inline-flex rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-1"
    >
      <ScopeChip
        href={cumulativeHref}
        label="Cumulative"
        sublabel={`Through MD ${matchDayNumber}`}
        active={active === "cumulative"}
        testId="scope-cumulative"
      />
      <ScopeChip
        href={weekHref}
        label="Week Only"
        sublabel="Sat + Sun pair"
        active={active === "week-only"}
        testId="scope-week-only"
      />
      <ScopeChip
        href={onlyHref}
        label="MD Only"
        sublabel={`MD ${matchDayNumber} alone`}
        active={active === "matchday-only"}
        testId="scope-md-only"
      />
    </div>
  );
}

function ScopeChip({
  href,
  label,
  sublabel,
  active,
  testId,
}: {
  href: string;
  label: string;
  sublabel: string;
  active: boolean;
  testId: string;
}) {
  return (
    <Link
      role="tab"
      aria-selected={active}
      data-testid={testId}
      href={href}
      className={
        "flex flex-col items-start rounded-sm px-4 py-2 transition-colors " +
        (active
          ? "bg-[var(--signal)]/15 text-[var(--signal)]"
          : "text-[var(--chalk-2)] hover:text-[var(--chalk-0)]")
      }
    >
      <span className="font-display text-[12px] font-bold uppercase tracking-[0.18em]">
        {label}
      </span>
      <span className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
        {sublabel}
      </span>
    </Link>
  );
}
