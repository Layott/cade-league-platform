// TODO (plan 41 P41-D): import from server/profile/h2h
export type H2HRow = {
  opponentId: string;
  opponentDisplayName: string;
  opponentGamerTag: string | null;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
};

/**
 * Plan 41 — head-to-head grid vs every other competitor in the season.
 * Responsive column count: 3 at lg, 2 at md, 1 at sm. Dominant colour in
 * each card indicates lifetime record vs that opponent: signal green =
 * positive record, flare = negative, chalk = level.
 */
export function H2HGrid({ rows }: { rows: H2HRow[] }) {
  return (
    <section data-testid="h2h-grid">
      <header className="mb-3 flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--chalk-3)]">
            Head to head
          </div>
          <h2 className="mt-1 font-display text-lg font-bold text-[var(--chalk-0)]">
            Record vs each competitor
          </h2>
        </div>
        <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
          {rows.length} opponents
        </span>
      </header>
      {rows.length === 0 ? (
        <div className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)] px-5 py-10 text-center text-sm text-[var(--chalk-3)]">
          No head-to-head history yet this season.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <H2HCard key={r.opponentId} row={r} />
          ))}
        </div>
      )}
    </section>
  );
}

function H2HCard({ row }: { row: H2HRow }) {
  const total = row.w + row.d + row.l;
  const verdict = row.w > row.l ? "up" : row.w < row.l ? "down" : "level";
  const accent =
    verdict === "up"
      ? "border-[var(--signal)]/40 before:bg-[var(--signal)]"
      : verdict === "down"
        ? "border-[var(--flare)]/40 before:bg-[var(--flare)]"
        : "border-[var(--ink-4)] before:bg-[var(--chalk-3)]";
  const gd = row.gf - row.ga;
  return (
    <article
      className={
        "relative overflow-hidden rounded-sm border bg-[var(--ink-2)] px-4 py-4 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:content-[''] " +
        accent
      }
      data-testid="h2h-card"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-display text-base font-bold leading-tight text-[var(--chalk-0)]">
            {row.opponentDisplayName}
          </h3>
          {row.opponentGamerTag ? (
            <div className="mt-0.5 text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
              @{row.opponentGamerTag}
            </div>
          ) : null}
        </div>
        <VerdictPill verdict={verdict} total={total} />
      </header>

      <dl className="mt-4 grid grid-cols-3 gap-px bg-[var(--ink-4)]">
        <Stat label="W" value={row.w} tone="positive" />
        <Stat label="D" value={row.d} muted />
        <Stat label="L" value={row.l} tone="negative" />
      </dl>

      <footer className="mt-3 flex items-center justify-between text-[11px] text-[var(--chalk-2)]">
        <span className="font-mono tabular">
          GF{" "}
          <span className="font-display text-[var(--chalk-0)]">{row.gf}</span>
          <span className="mx-1 text-[var(--chalk-3)]">·</span>
          GA{" "}
          <span className="font-display text-[var(--chalk-0)]">{row.ga}</span>
        </span>
        <span
          className={
            "font-mono tabular font-semibold " +
            (gd > 0
              ? "text-[var(--signal)]"
              : gd < 0
                ? "text-[var(--flare)]"
                : "text-[var(--chalk-3)]")
          }
        >
          GD {gd > 0 ? "+" + gd : gd}
        </span>
      </footer>
    </article>
  );
}

function Stat({
  label,
  value,
  tone,
  muted,
}: {
  label: string;
  value: number;
  tone?: "positive" | "negative";
  muted?: boolean;
}) {
  const color =
    tone === "positive"
      ? "text-[var(--signal)]"
      : tone === "negative"
        ? "text-[var(--flare)]"
        : muted
          ? "text-[var(--chalk-3)]"
          : "text-[var(--chalk-1)]";
  return (
    <div className="flex flex-col items-center justify-center bg-[var(--ink-2)] px-2 py-3">
      <dt className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
        {label}
      </dt>
      <dd
        className={
          "tabular mt-1 font-display text-lg font-bold leading-none " + color
        }
      >
        {value}
      </dd>
    </div>
  );
}

function VerdictPill({
  verdict,
  total,
}: {
  verdict: "up" | "down" | "level";
  total: number;
}) {
  if (total === 0) {
    return (
      <span className="shrink-0 rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-3)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
        No games
      </span>
    );
  }
  const map = {
    up: {
      cls: "border-[var(--signal)] bg-[var(--signal)]/15 text-[var(--signal)]",
      label: "Leading",
    },
    down: {
      cls: "border-[var(--flare)]/50 bg-[var(--flare)]/10 text-[var(--flare)]",
      label: "Trailing",
    },
    level: {
      cls: "border-[var(--ink-4)] bg-[var(--ink-3)] text-[var(--chalk-1)]",
      label: "Level",
    },
  } as const;
  const m = map[verdict];
  return (
    <span
      className={
        "shrink-0 rounded-sm border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.22em] " +
        m.cls
      }
    >
      {m.label}
    </span>
  );
}
