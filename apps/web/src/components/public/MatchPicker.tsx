import Link from "next/link";

export type MatchPickerItem = {
  id: string;
  match_order: number;
  home_tag: string;
  away_tag: string;
};

export function MatchPicker({
  matchDayNumber,
  matches,
  activeMatchId,
}: {
  matchDayNumber: number;
  matches: MatchPickerItem[];
  activeMatchId?: string | null;
}) {
  if (matches.length === 0) return null;
  const endActive = activeMatchId == null;
  return (
    <nav
      aria-label="Match cutoff picker"
      data-testid="match-picker"
      className="mb-6 flex flex-wrap gap-2"
    >
      <Link
        href={`/standings/matchday/${matchDayNumber}`}
        className={
          "rounded-sm border px-3 py-2 text-[11px] uppercase tracking-[0.18em] transition-colors " +
          (endActive
            ? "border-[var(--signal)] bg-[var(--signal)]/15 text-[var(--signal)]"
            : "border-[var(--ink-4)] bg-[var(--ink-2)] text-[var(--chalk-2)] hover:border-[var(--signal)] hover:text-[var(--chalk-0)]")
        }
      >
        End of MD
      </Link>
      {matches.map((m) => {
        const isActive = m.id === activeMatchId;
        return (
          <Link
            key={m.id}
            href={`/standings/matchday/${matchDayNumber}/match/${m.id}`}
            className={
              "rounded-sm border px-3 py-2 text-[11px] uppercase tracking-[0.18em] transition-colors " +
              (isActive
                ? "border-[var(--signal)] bg-[var(--signal)]/15 text-[var(--signal)]"
                : "border-[var(--ink-4)] bg-[var(--ink-2)] text-[var(--chalk-2)] hover:border-[var(--signal)] hover:text-[var(--chalk-0)]")
            }
          >
            <span className="font-display font-bold">M{m.match_order}</span>
            <span className="ml-2 text-[10px] text-[var(--chalk-3)]">
              {m.home_tag} v {m.away_tag}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
