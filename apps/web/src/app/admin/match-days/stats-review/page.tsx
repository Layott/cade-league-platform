import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceRoleSupabase } from "@/lib/supabase/service";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { StatusPill } from "@/components/admin/StatusPill";
import { formatWat } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * Plan 14 + Plan 47 follow-up — cross-match-day stats review hub.
 *
 * Shows every `match_stat_screenshots` row whose `parse_status` is not yet
 * confirmed/rejected, ordered oldest-first so the review queue works
 * FIFO. Each row deep-links to the existing per-screenshot review page
 * `/admin/match-days/[matchDayId]/stats-upload/[screenshotId]/review`.
 */
export default async function StatsReviewPage() {
  const userClient = await getServerSupabase();
  const { data: auth } = await userClient.auth.getUser();
  if (!auth.user) redirect("/login?next=/admin/match-days/stats-review");

  const svc = getServiceRoleSupabase();

  // Pull screenshots not yet confirmed. parse_status values: 'pending',
  // 'parsed', 'confirmed', 'rejected'. We care about everything except
  // 'confirmed' + 'rejected' (those are closed out).
  const { data: rows } = await svc
    .from("match_stat_screenshots")
    .select(
      "id, match_id, storage_path, parse_status, parsed_by_engine, uploaded_at, parsed_at, notes, matches:match_id ( id, match_day_id, home_player_id, away_player_id, match_days:match_day_id ( match_date ) )",
    )
    .in("parse_status", ["pending", "parsed", "failed"])
    .is("deleted_at", null)
    .order("uploaded_at", { ascending: true })
    .limit(100);

  type Row = {
    id: string;
    match_id: string;
    storage_path: string | null;
    parse_status: string;
    parsed_by_engine: string | null;
    uploaded_at: string;
    parsed_at: string | null;
    notes: string | null;
    matches: {
      id: string;
      match_day_id: string;
      home_player_id: string;
      away_player_id: string;
      match_days: { match_date: string } | null;
    } | null;
  };

  const queue = ((rows ?? []) as unknown as Row[]).filter(
    (r) => r.matches != null,
  );

  // Count badge stats.
  const counts = {
    pending: queue.filter((r) => r.parse_status === "pending").length,
    parsed: queue.filter((r) => r.parse_status === "parsed").length,
    failed: queue.filter((r) => r.parse_status === "failed").length,
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 md:px-6 md:py-10">
      <SectionHeader
        eyebrow="Admin"
        title="Stats review queue"
        description={`${queue.length} screenshot${queue.length === 1 ? "" : "s"} awaiting review. Parsed OCR rows need a human check before match results are finalised.`}
      />

      <div className="flex flex-wrap gap-2 text-xs">
        <StatusPill tone="amber">{counts.pending} pending parse</StatusPill>
        <StatusPill tone="primary">{counts.parsed} parsed, needs review</StatusPill>
        {counts.failed > 0 ? (
          <StatusPill tone="rose">{counts.failed} failed</StatusPill>
        ) : null}
      </div>

      {queue.length === 0 ? (
        <div className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-8 text-center text-sm text-[var(--chalk-3)]">
          No screenshots waiting. New uploads appear here as soon as they
          finish OCR.
        </div>
      ) : (
        <div className="overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--ink-1)] text-left text-[10px] uppercase tracking-[0.2em] text-[var(--chalk-3)]">
              <tr>
                <th className="px-4 py-3">Match day</th>
                <th className="px-4 py-3">Uploaded</th>
                <th className="px-4 py-3">Engine</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ink-4)]">
              {queue.map((r) => {
                const mdDate = r.matches?.match_days?.match_date ?? "—";
                const mdId = r.matches?.match_day_id ?? "";
                const reviewHref = `/admin/match-days/${mdId}/stats-upload/${r.id}/review`;
                const tone: "amber" | "primary" | "rose" =
                  r.parse_status === "failed"
                    ? "rose"
                    : r.parse_status === "parsed"
                      ? "primary"
                      : "amber";
                return (
                  <tr
                    key={r.id}
                    className="hover:bg-[var(--ink-1)]"
                    data-testid="stats-review-row"
                  >
                    <td className="px-4 py-3 font-mono tabular-nums text-[var(--chalk-1)]">
                      {mdDate}
                    </td>
                    <td className="px-4 py-3 text-[var(--chalk-2)]">
                      {formatWat(r.uploaded_at, "MMM d · HH:mm")}
                    </td>
                    <td className="px-4 py-3 text-[var(--chalk-2)]">
                      {r.parsed_by_engine ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill tone={tone}>{r.parse_status}</StatusPill>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {mdId ? (
                        <Link
                          href={reviewHref}
                          className="inline-flex items-center gap-1 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-[var(--chalk-1)] transition-colors hover:border-[var(--signal)] hover:text-[var(--signal)]"
                          data-testid="stats-review-link"
                        >
                          Review →
                        </Link>
                      ) : (
                        <span className="text-[var(--chalk-3)]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
