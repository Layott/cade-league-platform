// TODO (plan 41 P41-D): import from server/profile/playerStats
export type SeasonStats = {
  mp: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
  pointsDeducted: number;
  gdDeducted: number;
  tablePosition: number | null;
};

/**
 * Plan 41 — player self-service season stats summary.
 *
 * Two-column stat grid at lg, stacked on mobile. Numbers use the display
 * font for scoreboard feel; labels are tiny caps (font-mono tracking).
 * Points + position are treated as the "hero" values; deductions render
 * as small red sub-labels beside the affected metric.
 */
export function SeasonStatsCard({ stats }: { stats: SeasonStats }) {
  const posLabel = formatPosition(stats.tablePosition);
  const gdText = signed(stats.gd);
  return (
    <section
      className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]"
      data-testid="season-stats-card"
    >
      <header className="flex items-end justify-between gap-4 border-b border-[var(--ink-4)] bg-[var(--ink-1)] px-5 py-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--chalk-3)]">
            Season
          </div>
          <h2 className="mt-1 font-display text-xl font-bold text-[var(--chalk-0)]">
            Stats at a glance
          </h2>
        </div>
        <PositionBadge position={stats.tablePosition} />
      </header>

      <dl className="grid grid-cols-2 gap-px bg-[var(--ink-4)] lg:grid-cols-4">
        <Cell label="MP" value={stats.mp} />
        <Cell label="W" value={stats.w} tone="positive" />
        <Cell label="D" value={stats.d} muted />
        <Cell label="L" value={stats.l} tone="negative" />
        <Cell label="GF" value={stats.gf} />
        <Cell label="GA" value={stats.ga} muted />
        <Cell
          label="GD"
          valueText={gdText}
          tone={stats.gd > 0 ? "positive" : stats.gd < 0 ? "negative" : undefined}
          deduction={stats.gdDeducted > 0 ? `−${stats.gdDeducted}` : null}
        />
        <Cell
          label="Points"
          value={stats.points}
          hero
          deduction={stats.pointsDeducted > 0 ? `−${stats.pointsDeducted}` : null}
        />
      </dl>

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--ink-4)] bg-[var(--ink-1)] px-5 py-3 text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
        <span>
          Current position:{" "}
          <span className="font-mono tabular text-[var(--chalk-1)]">
            {posLabel}
          </span>
        </span>
        {stats.pointsDeducted > 0 || stats.gdDeducted > 0 ? (
          <span className="text-[var(--flare)]">
            Active deductions applied
          </span>
        ) : null}
      </footer>
    </section>
  );
}

function Cell({
  label,
  value,
  valueText,
  tone,
  muted = false,
  hero = false,
  deduction,
}: {
  label: string;
  value?: number;
  valueText?: string;
  tone?: "positive" | "negative";
  muted?: boolean;
  hero?: boolean;
  deduction?: string | null;
}) {
  const shown = valueText ?? (value == null ? "—" : String(value));
  const color = hero
    ? "text-[var(--chalk-0)]"
    : tone === "positive"
      ? "text-[var(--signal)]"
      : tone === "negative"
        ? "text-[var(--chalk-3)]"
        : muted
          ? "text-[var(--chalk-3)]"
          : "text-[var(--chalk-1)]";
  return (
    <div className="flex flex-col items-start gap-1 bg-[var(--ink-2)] px-5 py-4">
      <dt className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)] font-mono">
        {label}
      </dt>
      <dd className="flex items-baseline gap-2">
        <span
          className={
            "tabular font-display leading-none " +
            (hero ? "text-3xl font-bold " : "text-xl font-semibold ") +
            color
          }
        >
          {shown}
        </span>
        {deduction ? (
          <span
            className="inline-flex items-center rounded-sm border border-[var(--flare)]/50 bg-[var(--flare)]/10 px-1.5 py-0.5 text-[9px] font-bold tracking-[0.18em] text-[var(--flare)]"
            title="Deducted via sanction"
          >
            {deduction}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

function PositionBadge({ position }: { position: number | null }) {
  if (position == null) {
    return (
      <span className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-3)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
        Unranked
      </span>
    );
  }
  const isPodium = position <= 3;
  const base =
    "inline-flex items-center gap-2 rounded-sm border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em]";
  const cls = isPodium
    ? " border-[var(--signal)] bg-[var(--signal)]/10 text-[var(--signal)]"
    : " border-[var(--ink-4)] bg-[var(--ink-3)] text-[var(--chalk-1)]";
  return (
    <span className={base + cls}>
      <span aria-hidden className="text-[9px] text-[var(--chalk-3)]">
        POS
      </span>
      <span className="tabular font-display text-base leading-none">
        {formatPosition(position)}
      </span>
    </span>
  );
}

function formatPosition(pos: number | null): string {
  if (pos == null) return "—";
  const suffix = ordinalSuffix(pos);
  return `${pos}${suffix}`;
}

function ordinalSuffix(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

function signed(n: number): string {
  if (n > 0) return "+" + n;
  return String(n);
}
