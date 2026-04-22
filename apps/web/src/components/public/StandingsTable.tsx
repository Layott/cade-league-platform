import Link from "next/link";
import type { StandingsRow } from "@/server/standings/read";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";
import { getPlayerAvatarUrl } from "@/lib/player-photos";

const PODIUM_BADGE_STYLE = [
  // gold
  "bg-[var(--signal)] text-[var(--signal-ink)] border-[var(--signal)] shadow-[0_0_18px_-6px_var(--signal-glow)]",
  // silver
  "bg-[var(--chalk-0)] text-[var(--ink-0)] border-[var(--chalk-1)]",
  // bronze
  "bg-[var(--amber)] text-[var(--ink-0)] border-[var(--amber)]",
];

function rankBadge(rank: number): string {
  if (rank <= 3) return PODIUM_BADGE_STYLE[rank - 1];
  return "bg-[var(--ink-3)] text-[var(--chalk-1)] border-[var(--ink-5)]";
}

export function StandingsTable({ rows }: { rows: StandingsRow[] }) {
  return (
    <div
      className="relative overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]"
      data-testid="standings-wrap"
    >
      <div aria-hidden className="absolute inset-0 scanlines opacity-25" />
      <div className="relative overflow-x-auto">
        <table
          className="min-w-full text-sm"
          data-testid="standings-table"
        >
          <thead className="sticky top-0 z-10 bg-[var(--ink-1)] text-[10px] uppercase tracking-[0.2em] text-[var(--chalk-3)]">
            <tr>
              <th scope="col" className="w-14 px-3 py-3 text-left">
                Pos
              </th>
              <th scope="col" className="px-3 py-3 text-left">
                Competitor
              </th>
              <ColHeader label="MP" hint="Matches played" />
              <ColHeader label="W" hint="Wins" />
              <ColHeader label="D" hint="Draws" />
              <ColHeader label="L" hint="Losses" />
              <ColHeader label="GF" hint="Goals for" />
              <ColHeader label="GA" hint="Goals against" />
              <ColHeader label="GD" hint="Goal difference" />
              <th
                scope="col"
                className="w-16 px-3 py-3 text-right font-bold tracking-[0.22em] text-[var(--signal)]"
              >
                Pts
              </th>
            </tr>
          </thead>
          <tbody data-testid="standings-body" className="text-[var(--chalk-1)]">
            {rows.map((r, idx) => {
              const rank = idx + 1;
              const zebra =
                idx % 2 === 0 ? "bg-transparent" : "bg-[var(--ink-3)]/40";
              const deduction = r.punishment_points_deducted;
              return (
                <tr
                  key={r.player_id}
                  className={"border-t border-[var(--ink-4)] " + zebra}
                >
                  <td className="px-3 py-3">
                    <div
                      className={
                        "flex h-8 w-8 items-center justify-center rounded-sm border font-display text-sm font-bold " +
                        rankBadge(rank)
                      }
                    >
                      {rank}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-3">
                      <PlayerAvatar
                        photoUrl={getPlayerAvatarUrl(r.gamer_tag)}
                        displayName={r.player_name}
                        size={32}
                      />
                      <div className="min-w-0">
                        <div className="font-display text-[15px] font-semibold leading-tight text-[var(--chalk-0)]">
                          {r.player_name}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-[var(--chalk-3)]">
                          <span>@{r.gamer_tag}</span>
                          {deduction > 0 ? (
                            <span
                              className="inline-flex items-center gap-1 rounded-sm border border-[var(--flare)]/60 bg-[var(--flare)]/15 px-1.5 py-0.5 text-[9px] font-bold tracking-[0.15em] text-[var(--flare)]"
                              title={`Points deducted: ${deduction}`}
                            >
                              <span aria-hidden>!</span>
                              <span>−{deduction} pen</span>
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </td>
                  <NumCell value={r.matches_played} />
                  <NumCell value={r.wins} accent="positive" />
                  <NumCell value={r.draws} muted />
                  <NumCell value={r.losses} accent="negative" />
                  <NumCell value={r.goals_for} />
                  <NumCell value={r.goals_against} muted />
                  <NumCell
                    value={r.goal_difference}
                    signed
                    accent={
                      r.goal_difference > 0
                        ? "positive"
                        : r.goal_difference < 0
                          ? "negative"
                          : undefined
                    }
                  />
                  <td className="px-3 py-3 text-right">
                    <span className="tabular text-xl font-bold leading-none text-[var(--chalk-0)]">
                      {r.points}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="relative border-t border-[var(--ink-4)] bg-[var(--ink-1)] px-5 py-3 text-[11px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
        Tiebreak order:
        <span className="ml-2 text-[var(--chalk-1)]">
          Points → Goal difference → Goals for
        </span>
        <span className="mx-3 text-[var(--ink-5)]">·</span>
        <span>
          Penalty deductions shown beside{" "}
          <Link
            href="/punishments"
            className="underline decoration-[var(--signal)] underline-offset-4 hover:text-[var(--signal)]"
          >
            player tags
          </Link>
        </span>
      </div>
    </div>
  );
}

function ColHeader({ label, hint }: { label: string; hint: string }) {
  return (
    <th
      scope="col"
      title={hint}
      className="w-10 px-2 py-3 text-center font-semibold"
    >
      {label}
    </th>
  );
}

function NumCell({
  value,
  signed = false,
  muted = false,
  accent,
}: {
  value: number;
  signed?: boolean;
  muted?: boolean;
  accent?: "positive" | "negative";
}) {
  const color =
    accent === "positive"
      ? "text-[var(--signal)]"
      : accent === "negative"
        ? "text-[var(--chalk-3)]"
        : muted
          ? "text-[var(--chalk-3)]"
          : "text-[var(--chalk-1)]";
  const text = signed && value > 0 ? "+" + value : value.toString();
  return (
    <td className="px-2 py-3 text-center">
      <span className={"tabular text-sm " + color}>{text}</span>
    </td>
  );
}
