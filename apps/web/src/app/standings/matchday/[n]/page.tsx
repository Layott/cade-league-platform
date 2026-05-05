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
      away_player:away_player_id ( gamer_tag )
      `,
    )
    .eq("match_day_id", targetMd.id)
    .is("deleted_at", null)
    .order("match_order", { ascending: true });
  if (matchErr) throw new Error(`load matches failed: ${matchErr.message}`);

  const mdMatches: MatchPickerItem[] = ((matchData ?? []) as unknown as MatchRow[]).map(
    (m) => {
      const home = firstOrNull(m.home_player);
      const away = firstOrNull(m.away_player);
      return {
        id: m.id,
        match_order: m.match_order ?? 0,
        home_tag: home?.gamer_tag ?? "?",
        away_tag: away?.gamer_tag ?? "?",
      };
    },
  );

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

        {scope === "cumulative" ? (
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
