import Link from "next/link";

export type MatchDayPickerItem = {
  id: string;
  match_number: number;
  match_date: string;
};

export function MatchDayPicker({
  items,
  activeMatchDayId,
}: {
  items: MatchDayPickerItem[];
  activeMatchDayId?: string | null;
}) {
  if (items.length === 0) return null;
  return (
    <nav
      aria-label="Match day picker"
      data-testid="md-picker"
      className="mb-6 flex flex-wrap gap-2"
    >
      <Link
        href="/standings"
        className={
          "rounded-sm border px-3 py-2 text-[11px] uppercase tracking-[0.18em] transition-colors " +
          (activeMatchDayId == null
            ? "border-[var(--signal)] bg-[var(--signal)]/15 text-[var(--signal)]"
            : "border-[var(--ink-4)] bg-[var(--ink-2)] text-[var(--chalk-2)] hover:border-[var(--signal)] hover:text-[var(--chalk-0)]")
        }
      >
        Overall
      </Link>
      {items.map((md) => {
        const isActive = md.id === activeMatchDayId;
        return (
          <Link
            key={md.id}
            href={`/standings/matchday/${md.match_number}`}
            className={
              "rounded-sm border px-3 py-2 text-[11px] uppercase tracking-[0.18em] transition-colors " +
              (isActive
                ? "border-[var(--signal)] bg-[var(--signal)]/15 text-[var(--signal)]"
                : "border-[var(--ink-4)] bg-[var(--ink-2)] text-[var(--chalk-2)] hover:border-[var(--signal)] hover:text-[var(--chalk-0)]")
            }
          >
            <span className="font-display font-bold">MD {md.match_number}</span>
            <span className="ml-2 text-[10px] text-[var(--chalk-3)]">{md.match_date}</span>
          </Link>
        );
      })}
    </nav>
  );
}
