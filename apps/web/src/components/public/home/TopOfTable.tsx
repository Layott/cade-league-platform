import Link from "next/link";
import { EmptyState } from "@/components/public/EmptyState";
import type { StandingsRow } from "@/server/standings/read";

const PODIUM_LABELS = ["1st", "2nd", "3rd"];
const PODIUM_TONES = [
  {
    fill: "bg-[var(--signal)]",
    text: "text-[var(--signal-ink)]",
    border: "border-[var(--signal)]",
    glow: "shadow-[0_0_32px_-6px_var(--signal-glow)]",
  },
  {
    fill: "bg-[var(--chalk-0)]",
    text: "text-[var(--ink-0)]",
    border: "border-[var(--chalk-1)]",
    glow: "",
  },
  {
    fill: "bg-[var(--amber)]",
    text: "text-[var(--ink-0)]",
    border: "border-[var(--amber)]",
    glow: "",
  },
];

export function TopOfTable({ rows }: { rows: StandingsRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Standings go live after first whistle"
        hint="The table unlocks the moment match day 1 results are confirmed."
      />
    );
  }

  return (
    <div className="relative overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 scanlines opacity-30"
      />
      <ul className="relative divide-y divide-[var(--ink-4)]">
        {rows.slice(0, 3).map((r, idx) => {
          const tone = PODIUM_TONES[idx];
          return (
            <li
              key={r.player_id}
              className="group grid grid-cols-[auto_1fr_auto] items-center gap-5 px-5 py-4 transition-colors hover:bg-[var(--ink-3)]"
            >
              <div
                className={
                  "flex h-12 w-12 flex-col items-center justify-center rounded-sm border " +
                  tone.border +
                  " " +
                  tone.fill +
                  " " +
                  tone.glow
                }
              >
                <div
                  className={
                    "font-display text-xl font-bold leading-none " + tone.text
                  }
                >
                  {idx + 1}
                </div>
                <div
                  className={
                    "text-[9px] font-bold uppercase tracking-[0.14em] " +
                    tone.text
                  }
                >
                  {PODIUM_LABELS[idx]}
                </div>
              </div>

              <div className="min-w-0">
                <div className="truncate font-display text-lg font-bold leading-tight text-[var(--chalk-0)]">
                  {r.player_name}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
                  <span>@{r.gamer_tag}</span>
                  <span aria-hidden className="h-1 w-1 rounded-full bg-[var(--ink-5)]" />
                  <span className="tabular">
                    {r.wins}W · {r.draws}D · {r.losses}L
                  </span>
                </div>
              </div>

              <div className="flex flex-col items-end">
                <div className="tabular text-2xl font-bold leading-none text-[var(--chalk-0)]">
                  {r.points}
                </div>
                <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--chalk-3)]">
                  pts · GD{" "}
                  <span className="tabular text-[var(--chalk-1)]">
                    {r.goal_difference >= 0 ? "+" : ""}
                    {r.goal_difference}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-[var(--ink-4)] bg-[var(--ink-1)] px-5 py-3">
        <Link
          href="/standings"
          className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--chalk-1)] transition-colors hover:text-[var(--signal)]"
        >
          Full table
          <span aria-hidden>→</span>
        </Link>
      </div>
    </div>
  );
}
