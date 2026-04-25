import { getActiveSeason } from "@/server/seasons";
import { listPlayersInActiveSeason } from "@/server/players";
import { buildH2HCards } from "@/server/standings/h2h_view";
import { resolveTabGate } from "../_components/helpers";
import { H2HLookupClient } from "./H2HLookupClient";
import type { PickerPlayer } from "../_components/H2HPlayerPicker";

export const dynamic = "force-dynamic";

/**
 * Plan 51 — H2H Lookup tab.
 *
 * Server-renders the picker + initial 2-card comparison (top 2 in standings)
 * so the page is useful before the user touches anything. Refresh + new
 * picks fetch via `/api/tournament/h2h?ids=...`.
 */
export default async function H2HLookupPage() {
  const { svc } = await resolveTabGate("tournament.read");
  const season = await getActiveSeason(svc);
  if (!season) {
    return (
      <section className="space-y-4" data-testid="tournament-tab-h2h-lookup">
        <Empty />
      </section>
    );
  }

  const players = await listPlayersInActiveSeason(svc);
  const pickerPlayers: PickerPlayer[] = players
    .map((p) => ({
      id: p.id,
      name: p.display_name,
      gamerTag: p.gamer_tag ?? p.display_name,
    }))
    .sort((a, b) => a.gamerTag.localeCompare(b.gamerTag));

  const initialSelection = pickerPlayers.slice(0, 2).map((p) => p.id);
  const cards =
    initialSelection.length >= 2
      ? await buildH2HCards(svc, season.id, initialSelection)
      : [];

  return (
    <section className="space-y-5" data-testid="tournament-tab-h2h-lookup">
      <header className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          Head-to-head · pick 2-5 players
        </div>
        <p className="text-[12px] text-[var(--chalk-2)]">
          Side-by-side comparison cards using the same stat subset as the
          broadcast H2H overlays. Win probability is each player&apos;s average
          chance of winning against every other selected player.
        </p>
      </header>
      <H2HLookupClient
        players={pickerPlayers}
        cards={cards}
        initialSelection={initialSelection}
      />
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
        H2H comparisons need an active season&apos;s results.
      </p>
    </div>
  );
}
