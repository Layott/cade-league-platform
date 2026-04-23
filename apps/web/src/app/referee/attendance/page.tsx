import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { formatWat } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * Plan 46 — /referee/attendance. Landing view: today's match-days first,
 * then upcoming. One-click "Mark attendance" button per row jumps into the
 * simplified grid at /referee/attendance/[matchDayId]. Middleware already
 * gates entry to roles ∈ {referee, admin, moderator}.
 */
export default async function RefereeAttendanceIndex() {
  const sb = await getServerSupabase();

  const { data: season } = await sb
    .from("seasons")
    .select("id, year_range")
    .is("deleted_at", null)
    .eq("status", "active")
    .maybeSingle();

  // Today in WAT (Africa/Lagos). No DST so we can format directly.
  const today = formatWat(new Date(), "yyyy-MM-dd");

  const days = season
    ? (
        await sb
          .from("match_days")
          .select("id, match_date, match_start_time, arrival_cutoff_time, venue_name, status")
          .eq("season_id", season.id)
          .is("deleted_at", null)
          .gte("match_date", today)
          .order("match_date", { ascending: true })
          .limit(20)
      ).data ?? []
    : [];

  type Day = {
    id: string;
    match_date: string;
    match_start_time: string;
    arrival_cutoff_time: string;
    venue_name: string | null;
    status: string;
  };

  const rows = (days as Day[]).map((d) => ({
    ...d,
    isToday: d.match_date === today,
  }));

  return (
    <div className="space-y-8" data-testid="referee-attendance-index">
      <div>
        <h1 className="font-display text-2xl font-bold text-[var(--chalk-0)]">
          Mark attendance
        </h1>
        <p className="mt-1 text-sm text-[var(--chalk-3)]">
          Pick a match day below to open the 13-player grid.
        </p>
      </div>

      {rows.length === 0 ? (
        <div
          className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-8 text-center text-sm text-[var(--chalk-3)]"
          data-testid="ref-att-empty"
        >
          No upcoming match days scheduled.
        </div>
      ) : (
        <ul className="space-y-2" data-testid="ref-att-list">
          {rows.map((d) => (
            <li
              key={d.id}
              className={
                "flex flex-col gap-3 rounded-sm border px-5 py-4 sm:flex-row sm:items-center sm:justify-between " +
                (d.isToday
                  ? "border-[var(--signal)] bg-[rgba(107,205,6,0.07)]"
                  : "border-[var(--ink-4)] bg-[var(--ink-2)]")
              }
              data-testid={`ref-att-day-${d.id}`}
            >
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-display text-lg font-semibold text-[var(--chalk-0)] tabular">
                    {d.match_date}
                  </span>
                  {d.isToday ? (
                    <span className="rounded-sm bg-[var(--signal)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--signal-ink)]">
                      Today
                    </span>
                  ) : null}
                  <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--chalk-3)]">
                    {d.status}
                  </span>
                </div>
                <div className="text-xs text-[var(--chalk-3)]">
                  Call{" "}
                  <span className="font-mono text-[var(--chalk-1)]">
                    {String(d.arrival_cutoff_time).slice(0, 5)}
                  </span>{" "}
                  · KO{" "}
                  <span className="font-mono text-[var(--chalk-1)]">
                    {String(d.match_start_time).slice(0, 5)}
                  </span>
                  {d.venue_name ? (
                    <>
                      {" "}
                      · <span>{d.venue_name}</span>
                    </>
                  ) : null}
                </div>
              </div>
              <Link
                href={`/referee/attendance/${d.id}`}
                data-testid={`ref-att-open-${d.id}`}
                className="inline-flex items-center justify-center rounded-sm bg-[var(--signal)] px-5 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-[var(--signal-ink)] transition-colors hover:bg-[var(--signal)]/90"
              >
                Mark attendance →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
