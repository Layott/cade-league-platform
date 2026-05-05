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
  result:
    | { confirmed_at: string | null; result_type: string; deleted_at: string | null }
    | { confirmed_at: string | null; result_type: string; deleted_at: string | null }[]
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

  // Reject deep-links to unplayed matches: 404 unless this match has a
  // confirmed, non-void result.
  const { data: resultRows, error: resultErr } = await sb
    .from("match_results")
    .select("confirmed_at, result_type")
    .eq("match_id", matchId)
    .is("deleted_at", null)
    .not("confirmed_at", "is", null)
    .in("result_type", ["normal", "forfeit"])
    .limit(1);
  if (resultErr) throw new Error(`load match result failed: ${resultErr.message}`);
  if (!resultRows || resultRows.length === 0) notFound();

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
      away_player:away_player_id ( gamer_tag ),
      result:match_results ( confirmed_at, result_type, deleted_at )
      `,
    )
    .eq("match_day_id", targetMd.id)
    .is("deleted_at", null);
  if (matchErr) throw new Error(`load matches failed: ${matchErr.message}`);

  type PlayedRow = { row: MatchRow; confirmed_at: string };
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
      match_order: idx + 1,
      home_tag: home?.gamer_tag ?? "?",
      away_tag: away?.gamer_tag ?? "?",
    };
  });

  // Re-derive THIS match's chip number (1-based in result-entry order) so
  // the page heading matches the chip the user clicked from.
  const targetChipIndex = played.findIndex(({ row }) => row.id === targetMatch.id);
  const targetChipNumber = targetChipIndex >= 0 ? targetChipIndex + 1 : targetMatch.match_order;

  return (
    <div>
      <PageHeader
        eyebrow={`${season.division_name} · ${season.year_range}`}
        title={`Standings · MD ${n} · Match ${targetChipNumber}`}
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
            Match #{targetChipNumber}
          </span>
        </nav>

        <MatchDayPicker items={mdItems} activeMatchDayId={targetMd.id} />
        {mdMatches.length > 0 ? (
          <MatchPicker
            matchDayNumber={n}
            matches={mdMatches}
            activeMatchId={targetMatch.id}
          />
        ) : null}

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
