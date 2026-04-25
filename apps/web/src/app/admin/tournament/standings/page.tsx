import { getActiveSeason } from "@/server/seasons";
import { loadLeaderboard } from "@/server/standings/leaderboard_view";
import { resolveTabGate, viewerCan } from "../_components/helpers";
import { LiveLeaderboard } from "../_components/LiveLeaderboard";
import { DownloadButtons } from "../_components/DownloadButtons";

export const dynamic = "force-dynamic";

/**
 * Plan 51 — Standings tab.
 *
 * Server-renders the initial 13-row leaderboard with tiebreaker order
 * applied + form column populated. LiveLeaderboard subscribes to the
 * standings.changed channel and re-fetches over /api/tournament/leaderboard.
 *
 * Download buttons render conditionally on `tournament.export` perm.
 */
export default async function StandingsPage() {
  const { actor, svc } = await resolveTabGate("tournament.read");
  const season = await getActiveSeason(svc);
  const rows = season ? await loadLeaderboard(svc, season.id) : [];
  const canExport = await viewerCan(svc, actor, "tournament.export");

  return (
    <section className="space-y-6" data-testid="tournament-tab-standings">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Live standings · {season?.year_range ?? "no active season"}
          </div>
          <p className="text-[12px] text-[var(--chalk-2)]">
            Sorted by the season&apos;s configured tiebreaker ladder. Form column
            shows the most recent five results (oldest → newest).
          </p>
        </div>
        {canExport ? <DownloadButtons /> : null}
      </header>
      <LiveLeaderboard seasonId={season?.id ?? null} initialRows={rows} />
    </section>
  );
}
