import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  listSeasonMatchDays,
  listStandingsAsOf,
} from "@/server/standings/cutoff";
import { getActiveSeason } from "@/server/seasons";
import { PageHeader } from "@/components/public/PageHeader";
import { StandingsTable } from "@/components/public/StandingsTable";
import { EmptyState } from "@/components/public/EmptyState";
import { MatchDayPicker } from "@/components/public/MatchDayPicker";
import {
  MatchPicker,
  type MatchPickerItem,
} from "@/components/public/MatchPicker";
import {
  StandingsScopeToggle,
  type StandingsScope,
} from "@/components/public/StandingsScopeToggle";

export const revalidate = 60;

export const metadata = { title: "Matchday standings" };

type MatchRow = {
  id: string;
  match_order: number | null;
  home_player:
    | { gamer_tag: string }
    | { gamer_tag: string }[]
    | null;
  away_player:
    | { gamer_tag: string }
    | { gamer_tag: string }[]
    | null;
  result:
    | { confirmed_at: string | null; result_type: string; deleted_at: string | null }
    | { confirmed_at: string | null; result_type: string; deleted_at: string | null }[]
    | null;
};

function firstOrNull<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function parseScope(value: string | string[] | undefined): StandingsScope {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "md-only") return "matchday-only";
  if (raw === "week-only") return "week-only";
  return "cumulative";
}

export default async function MatchdayStandingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ n: string }>;
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const { n: nRaw } = await params;
  const { view } = await searchParams;
  const scope = parseScope(view);
  const n = Number.parseInt(nRaw, 10);
  if (!Number.isFinite(n) || n < 1) notFound();

  const sb = await getServerSupabase();
  const season = await getActiveSeason(sb);
  if (!season) {
    return (
      <div>
        <PageHeader
          eyebrow="Standings"
          title={`Standings · MD ${n}`}
          description={
            scope === "matchday-only"
              ? "Points scored only in this matchday."
              : "Cumulative standings as of the end of this matchday."
          }
        />
        <div className="mx-auto max-w-6xl px-5 py-10">
          <EmptyState
            title="Season not active"
            hint="Standings open once the active season begins."
          />
        </div>
      </div>
    );
  }

  const mdItems = await listSeasonMatchDays(sb, season.id);
  const targetMd = mdItems.find((md) => md.match_number === n);
  if (!targetMd) notFound();

  const rows = await listStandingsAsOf(
    sb,
    season.id,
    scope === "matchday-only"
      ? { type: "matchday-only", matchDayId: targetMd.id }
      : scope === "week-only"
        ? { type: "week-only", matchDayId: targetMd.id }
        : { type: "matchday", matchDayId: targetMd.id },
  );

  const { data: matchData, error: matchErr } = await sb
    .from("matches")
    .select(
      `
      id, match_order,
      home_player:home_player_id ( gamer_tag ),
      away_player:away_player_id ( gamer_tag ),
      result:match_results ( confirmed_at, result_type, deleted_at )
      `,
    )
    .eq("match_day_id", targetMd.id)
    .is("deleted_at", null);
  if (matchErr) throw new Error(`load matches failed: ${matchErr.message}`);

  // Filter to played matches with confirmed normal/forfeit result, then sort
  // by the order results were entered (confirmed_at ascending) so the chip
  // sequence matches the live entry order, not the announced match_order.
  type PlayedRow = {
    row: MatchRow;
    confirmed_at: string;
  };
  const played: PlayedRow[] = [];
  for (const row of (matchData ?? []) as unknown as MatchRow[]) {
    const r = firstOrNull(row.result);
    if (!r || r.deleted_at) continue;
    if (!r.confirmed_at) continue;
    if (r.result_type !== "normal" && r.result_type !== "forfeit") continue;
    played.push({ row, confirmed_at: r.confirmed_at });
  }
  played.sort((a, b) => a.confirmed_at.localeCompare(b.confirmed_at));

  const mdMatches: MatchPickerItem[] = played.map(({ row }, idx) => {
    const home = firstOrNull(row.home_player);
    const away = firstOrNull(row.away_player);
    return {
      id: row.id,
      // Re-number chips 1..N in result-entry order (NOT announced match_order)
      // so users see "M1, M2, M3..." reflecting which result was entered first.
      match_order: idx + 1,
      home_tag: home?.gamer_tag ?? "?",
      away_tag: away?.gamer_tag ?? "?",
    };
  });

  const description =
    scope === "matchday-only"
      ? "Points, wins, and goals scored only in this matchday."
      : scope === "week-only"
        ? "Points, wins, and goals scored across the Saturday + Sunday pair."
        : "Cumulative standings as of the end of this matchday.";

  const breadcrumbScopeLabel =
    scope === "matchday-only"
      ? `MD ${n} · MD only`
      : scope === "week-only"
        ? `MD ${n} · Week only`
        : `MD ${n}`;

  return (
    <div>
      <PageHeader
        eyebrow={`${season.division_name} · ${season.year_range}`}
        title={`Standings · MD ${n}`}
        description={description}
      />

      <div className="mx-auto max-w-6xl px-5 py-10">
        <nav
          aria-label="Breadcrumb"
          className="mb-4 text-[11px] uppercase tracking-[0.2em] text-[var(--chalk-3)]"
        >
          <Link
            href="/standings"
            className="hover:text-[var(--signal)] hover:underline underline-offset-4"
          >
            Overall
          </Link>
          <span className="mx-2 text-[var(--ink-5)]">·</span>
          <span className="text-[var(--chalk-1)]">{breadcrumbScopeLabel}</span>
        </nav>

        <MatchDayPicker items={mdItems} activeMatchDayId={targetMd.id} />

        <StandingsScopeToggle
          matchDayNumber={n}
          active={scope}
        />

        {scope === "cumulative" && mdMatches.length > 0 ? (
          <MatchPicker
            matchDayNumber={n}
            matches={mdMatches}
            activeMatchId={null}
          />
        ) : null}

        {rows.length === 0 ? (
          <EmptyState
            title="No standings yet for this matchday"
            hint="Standings populate as match results are confirmed."
          />
        ) : (
          <StandingsTable rows={rows} />
        )}
      </div>
    </div>
  );
}
