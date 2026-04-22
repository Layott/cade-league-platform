import { formatWat } from "@/lib/time";

// TODO (plan 41 P41-D): import from server/profile/playerStats
export type FormEntry = {
  result: "W" | "D" | "L";
  opponent: string;
  matchDate: string; // ISO timestamp
  homeScore: number;
  awayScore: number;
};

/**
 * Plan 41 — last-5 form strip. Leftmost pill = oldest, rightmost = most
 * recent. Hover tooltip (title attr) shows opponent + score + date. If the
 * player has fewer than 5 matches the trailing slots render as dim
 * placeholders so the strip reads consistently across the league.
 */
export function FormStrip({ form }: { form: FormEntry[] }) {
  const slots = [...form.slice(0, 5)];
  const padCount = Math.max(0, 5 - slots.length);
  return (
    <section
      className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-5 py-4"
      data-testid="form-strip"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--chalk-3)]">
            Form
          </div>
          <h2 className="mt-1 font-display text-lg font-bold text-[var(--chalk-0)]">
            Last 5 matches
          </h2>
        </div>
        <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
          Oldest → Newest
        </span>
      </div>

      <ul
        className="mt-4 flex items-center gap-2"
        data-testid="form-pills"
      >
        {slots.map((e, i) => (
          <FormPill key={`${e.matchDate}-${i}`} entry={e} />
        ))}
        {Array.from({ length: padCount }).map((_, i) => (
          <EmptyPill key={`pad-${i}`} />
        ))}
      </ul>
    </section>
  );
}

function FormPill({ entry: e }: { entry: FormEntry }) {
  const tone = TONE[e.result];
  let dateLabel = "";
  try {
    dateLabel = formatWat(e.matchDate, "yyyy-MM-dd");
  } catch {
    dateLabel = e.matchDate.slice(0, 10);
  }
  const title = `${e.result} vs ${e.opponent} · ${e.homeScore}-${e.awayScore} · ${dateLabel}`;
  return (
    <li
      className={
        "flex h-9 w-9 items-center justify-center rounded-sm border font-display text-base font-bold tabular transition-colors " +
        tone
      }
      title={title}
      data-testid={`form-pill-${e.result}`}
      aria-label={title}
    >
      {e.result}
    </li>
  );
}

function EmptyPill() {
  return (
    <li
      className="flex h-9 w-9 items-center justify-center rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-1)] font-display text-base font-bold text-[var(--chalk-3)]"
      aria-hidden
      data-testid="form-pill-empty"
    >
      –
    </li>
  );
}

const TONE: Record<"W" | "D" | "L", string> = {
  W: "border-[var(--signal)] bg-[var(--signal)]/15 text-[var(--signal)]",
  D: "border-[var(--amber)]/60 bg-[var(--amber)]/10 text-[var(--amber)]",
  L: "border-[var(--flare)]/50 bg-[var(--flare)]/10 text-[var(--flare)]",
};
