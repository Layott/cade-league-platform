import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { listMatchDaysWithTags } from "@/server/matches/match-days";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { PrimaryButton } from "@/components/admin/buttons";
import {
  MatchDaysSearchTable,
  type MatchDayRow,
} from "@/components/admin/MatchDaysSearchTable";

export const dynamic = "force-dynamic";

export default async function MatchDaysPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sb = await getServerSupabase();
  const { data: season } = await sb
    .from("seasons")
    .select("id, year_range")
    .is("deleted_at", null)
    .eq("status", "active")
    .maybeSingle();

  const days = season ? await listMatchDaysWithTags(sb, season.id) : [];
  const { q } = await searchParams;

  const rows: MatchDayRow[] = days.map((d) => ({
    id: d.id,
    match_date: d.match_date,
    venue_name: d.venue_name,
    status: d.status,
    match_count: d.match_count,
    player_tags: d.player_tags,
    published_at: d.published_at,
  }));

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Calendar"
        title="Match days"
        description="Every past, current, and upcoming session for the active season. Click a row to enter fixtures or mark attendance."
        action={
          <Link href="/admin/match-days/new" data-testid="new-match-day-link">
            <PrimaryButton>+ New match day</PrimaryButton>
          </Link>
        }
      />

      <MatchDaysSearchTable rows={rows} initialQuery={q ?? ""} />
    </div>
  );
}
