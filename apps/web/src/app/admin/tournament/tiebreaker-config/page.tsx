import { getActiveSeason } from "@/server/seasons";
import { resolveTabGate } from "../_components/helpers";
import {
  TiebreakerDragRank,
  DEFAULT_ORDER,
} from "../_components/TiebreakerDragRank";
import { saveTiebreakerOrderAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Plan 51 — Tiebreaker Config tab.
 *
 * Reads `seasons.tiebreaker_order` JSONB for the active season + renders
 * the drag-rank component. Save fires through a server action that
 * gates on `tournament.tiebreaker_config` and broadcasts standings.changed
 * so the LiveLeaderboard re-sorts in place.
 */
export default async function TiebreakerConfigPage() {
  const { svc } = await resolveTabGate("tournament.tiebreaker_config");
  const season = await getActiveSeason(svc);

  if (!season) {
    return (
      <section className="space-y-6" data-testid="tournament-tab-tiebreakers">
        <Empty />
      </section>
    );
  }

  const { data } = await svc
    .from("seasons")
    .select("tiebreaker_order")
    .eq("id", season.id)
    .maybeSingle();

  const order =
    Array.isArray((data as { tiebreaker_order?: string[] | null } | null)?.tiebreaker_order)
      ? ((data as { tiebreaker_order: string[] }).tiebreaker_order as string[])
      : DEFAULT_ORDER;

  return (
    <section className="space-y-6" data-testid="tournament-tab-tiebreakers">
      <header className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          Tiebreaker ladder · {season.year_range}
        </div>
        <p className="text-[12px] text-[var(--chalk-2)]">
          Drag (or use ↑/↓) to reorder. Save persists the JSONB array and
          publishes standings.changed so live overlays re-sort. When all
          configured rules tie, the engine breaks the remaining tie
          alphabetically — that anchor is automatic and not user-configurable.
        </p>
      </header>
      <TiebreakerDragRank initialOrder={order} saveAction={saveTiebreakerOrderAction} />
    </section>
  );
}

function Empty() {
  return (
    <div className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)]/40 p-12 text-center">
      <div className="font-display text-base text-[var(--chalk-1)]">
        No active season
      </div>
      <p className="mt-1 text-[12px] text-[var(--chalk-3)]">
        Tiebreaker config attaches to the active season&apos;s row.
      </p>
    </div>
  );
}
