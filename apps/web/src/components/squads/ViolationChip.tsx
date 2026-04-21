import type { Violation } from "@/server/squads";

/**
 * Plan 10 — compact red chip that names the specific rule violation.
 * Used on /admin/squads/[id] and in the /player/squad preview panel.
 */
function label(v: Violation): string {
  switch (v.code) {
    case "budget_exceeded":
      return `Budget ${v.totalValue.toLocaleString()} > ${v.maxBudgetCoins.toLocaleString()}`;
    case "missing_nigerian_items":
      return `Nigerian items: ${v.actualCount}/${v.required}`;
    case "banned_item_type":
      return `Banned: ${v.itemName} (${v.itemType})`;
    case "starting_xi_incomplete":
      return `XI: ${v.filledSlots}/11 filled`;
  }
}

export function ViolationChip({ v }: { v: Violation }) {
  return (
    <span
      data-testid={`violation-${v.code}`}
      className="inline-flex items-center gap-1.5 rounded-sm border border-[rgba(255,91,59,0.45)] bg-[rgba(255,91,59,0.1)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--flare)]"
    >
      {label(v)}
    </span>
  );
}

export function ViolationList({ items }: { items: Violation[] }) {
  if (items.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-sm border border-[rgba(107,205,6,0.35)] bg-[rgba(107,205,6,0.1)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--primary)]">
        no violations
      </span>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="violation-list">
      {items.map((v, i) => (
        <ViolationChip key={`${v.code}-${i}`} v={v} />
      ))}
    </div>
  );
}
