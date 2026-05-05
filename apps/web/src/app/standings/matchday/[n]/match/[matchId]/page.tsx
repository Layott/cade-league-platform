import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  listSeasonMatchDays,
  listSeasonMatchesOrdered,
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

export const revalidate = 60;

export const metadata = { title: "Match standings" };

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

export default async function MatchStandingsPage({
  params,
}: {
  params: Promise<{ n: string; matchId: string }>;
}) {
  const { n: nRaw, matchId } = await params;
  const n = Number.parseInt(nRaw, 10);
  if (!Number.isFinite(n) || n < 1) notFound();
  if (!matchId || matchId.length === 0) notFound();

  const sb = await getServerSupabase();
  const season = await getActiveSeason(sb);
  if (!season) {
    return (
      <div>
        <PageHeader
          eyebrow="Standings"
          title={`Standings · MD ${n}`}
          description="Cumulative standings as of after this match."
        />
        <div className="mx-auto max-w-6xl px-5 py-10">
          <EmptyState
            title="Season not active"
            hint="Cumulative standings open once the active season begins."
          />
        </div>
      </div>
    );
  }

  const mdItems = await listSeasonMatchDays(sb, season.id);
  const targetMd = mdItems.find((md) => md.match_number === n);
  if (!targetMd) notFound();

  const ordered = await listSeasonMatchesOrdered(sb, season.id);
  const targetMatch = ordered.find((m) => m.id === matchId);
  if (!targetMatch) notFound();
  if (targetMatch.match_day_id !== targetMd.id) notFound();

  const rows = await listStandingsAsOf(sb, season.id, {
    type: "match",
    matchId: targetMatch.id,
  });

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

  return (
    <div>
      <PageHeader
        eyebrow={`${season.division_name} · ${season.year_range}`}
        title={`Standings · MD ${n} · Match ${targetMatch.match_order}`}
        description="Cumulative standings as of after this match."
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
          <Link
            href={`/standings/matchday/${n}`}
            className="hover:text-[var(--signal)] hover:underline underline-offset-4"
          >
            MD {n}
          </Link>
          <span className="mx-2 text-[var(--ink-5)]">·</span>
          <span className="text-[var(--chalk-1)]">
            Match #{targetMatch.match_order}
          </span>
        </nav>

        <MatchDayPicker items={mdItems} activeMatchDayId={targetMd.id} />
        <MatchPicker
          matchDayNumber={n}
          matches={mdMatches}
          activeMatchId={targetMatch.id}
        />

        {rows.length === 0 ? (
          <EmptyState
            title="No standings yet at this cutoff"
            hint="Standings populate as match results are confirmed."
          />
        ) : (
          <StandingsTable rows={rows} />
        )}
      </div>
    </div>
  );
}
