import { getActiveSeason } from "@/server/seasons";
import { listPlayersInActiveSeason } from "@/server/players";
import { resolveTabGate } from "../_components/helpers";
import {
  WinProbCalculator,
  type CalcPlayer,
} from "./WinProbCalculator";

export const dynamic = "force-dynamic";

/**
 * Plan 51 — Win-Prob Preview tab.
 *
 * Calculator-style view: pick A + B, see formula breakdown + probability
 * triple. The math + Realtime breakdown live in the
 * /api/tournament/win-probability endpoint; this server component just
 * supplies the player list to the client component.
 */
export default async function WinProbPreviewPage() {
  const { svc } = await resolveTabGate("tournament.read");
  const season = await getActiveSeason(svc);
  if (!season) {
    return (
      <section className="space-y-4" data-testid="tournament-tab-win-prob-preview">
        <Empty />
      </section>
    );
  }
  const players = await listPlayersInActiveSeason(svc);
  const calcPlayers: CalcPlayer[] = players
    .map((p) => ({
      id: p.id,
      name: p.display_name,
      gamerTag: p.gamer_tag ?? p.display_name,
    }))
    .sort((a, b) => a.gamerTag.localeCompare(b.gamerTag));

  if (calcPlayers.length < 2) {
    return (
      <section className="space-y-4" data-testid="tournament-tab-win-prob-preview">
        <Empty message="Need at least two registered players to compute a win probability." />
      </section>
    );
  }

  const defaultA = calcPlayers[0]!.id;
  const defaultB = calcPlayers[1]!.id;

  return (
    <section className="space-y-5" data-testid="tournament-tab-win-prob-preview">
      <header className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
          Win-probability calculator
        </div>
        <p className="text-[12px] text-[var(--chalk-2)]">
          Mirrors the Strength formula from the xlsx scout sheet:{" "}
          <code className="text-[var(--primary)]">
            0.4·H2H + 0.4·Season + 0.2·Last5
          </code>
          . Falls back to <code className="text-[var(--primary)]">0.6·Season + 0.4·Last5</code>{" "}
          when no head-to-head history is available.
        </p>
      </header>
      <WinProbCalculator
        players={calcPlayers}
        defaultA={defaultA}
        defaultB={defaultB}
      />
    </section>
  );
}

function Empty({
  message = "Win-probability needs an active season + at least two registered players.",
}: {
  message?: string;
} = {}) {
  return (
    <div className="rounded-sm border border-dashed border-[var(--ink-4)] bg-[var(--ink-2)]/40 p-12 text-center">
      <div className="font-display text-base text-[var(--chalk-1)]">
        Not available
      </div>
      <p className="mt-1 text-[12px] text-[var(--chalk-3)]">{message}</p>
    </div>
  );
}
