// TODO (plan 41 P41-D): import from server/profile/playerStats
export type Streaks = {
  winStreak: number;
  unbeatenStreak: number;
  goalScoringStreak: number;
};

/**
 * Plan 41 — three active streaks. Designed to sit next to FormStrip so the
 * two read as a "recent momentum" pair. Zero-valued streaks render dim;
 * any non-zero streak picks up the signal accent.
 */
export function CurrentStreaks({ streaks }: { streaks: Streaks }) {
  return (
    <section
      className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]"
      data-testid="current-streaks"
    >
      <header className="border-b border-[var(--ink-4)] bg-[var(--ink-1)] px-5 py-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--chalk-3)]">
          Active streaks
        </div>
        <h2 className="mt-1 font-display text-lg font-bold text-[var(--chalk-0)]">
          Current momentum
        </h2>
      </header>
      <dl className="grid grid-cols-3 divide-x divide-[var(--ink-4)]">
        <StreakCell label="Wins" value={streaks.winStreak} />
        <StreakCell label="Unbeaten" value={streaks.unbeatenStreak} />
        <StreakCell label="Scoring" value={streaks.goalScoringStreak} />
      </dl>
    </section>
  );
}

function StreakCell({ label, value }: { label: string; value: number }) {
  const active = value > 0;
  return (
    <div
      className="flex flex-col items-center justify-center px-4 py-5"
      data-testid={`streak-${label.toLowerCase()}`}
    >
      <dt className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)] font-mono">
        {label}
      </dt>
      <dd className="mt-2 flex items-baseline gap-1">
        <span
          className={
            "tabular font-display text-3xl font-bold leading-none " +
            (active ? "text-[var(--signal)]" : "text-[var(--chalk-3)]")
          }
        >
          {value}
        </span>
        <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
          {value === 1 ? "game" : "games"}
        </span>
      </dd>
    </div>
  );
}
