import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { formatWat } from "@/lib/time";
import { listByMatchDay } from "@/server/attendance";
import { getPlayerAvatarUrl } from "@/lib/player-photos";
import {
  markAction,
  editAction,
} from "@/app/admin/match-days/[id]/attendance/actions";

export const dynamic = "force-dynamic";

/**
 * Plan 46 — /referee/attendance/[matchDayId]. Simplified grid: 13 tiles,
 * two big buttons per tile (PRESENT / LATE), a summary strip, and a back
 * link. Server actions (`markAction`, `editAction`) are imported straight
 * from the admin equivalent so the write path (incl. audit) is shared.
 *
 * Tap targets are ≥44×44 px to satisfy mobile-first accessibility.
 *
 * NOTE: the brief listed PRESENT + LATE as primary buttons. ABSENT is
 * intentionally omitted from the big-button row so refs don't accidentally
 * issue a 3-point penalty from a phone; absent-marking is still done via
 * the admin surface.
 */
export default async function RefereeMarkAttendance({
  params,
}: {
  params: Promise<{ matchDayId: string }>;
}) {
  const { matchDayId } = await params;
  const sb = await getServerSupabase();

  const { data: md } = await sb
    .from("match_days")
    .select("match_date, match_start_time, arrival_cutoff_time, venue_name, status")
    .eq("id", matchDayId)
    .maybeSingle();

  const roster = await listByMatchDay(sb, matchDayId);

  const marked = roster.filter((r) => r.status !== null).length;
  const late = roster.filter((r) => r.status === "late").length;
  const missing = roster.length - marked;

  return (
    <div className="space-y-6" data-testid="ref-mark-page">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href="/referee/attendance"
            className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--chalk-3)] hover:text-[var(--chalk-0)]"
            data-testid="ref-mark-back"
          >
            ← Back to match days
          </Link>
          <h1 className="font-display text-2xl font-bold text-[var(--chalk-0)]">
            Attendance grid
          </h1>
          {md ? (
            <p className="mt-1 text-xs uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              <span className="text-[var(--chalk-1)] tabular">{md.match_date}</span>
              {" · Call "}
              <span className="text-[var(--chalk-1)] tabular">
                {String(md.arrival_cutoff_time).slice(0, 5)}
              </span>
              {" · KO "}
              <span className="text-[var(--chalk-1)] tabular">
                {String(md.match_start_time).slice(0, 5)}
              </span>
              {md.venue_name ? <> · {md.venue_name}</> : null}
            </p>
          ) : null}
        </div>
      </div>

      {/* Summary strip */}
      <div
        className="flex flex-wrap items-center gap-4 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-5 py-3 text-xs uppercase tracking-[0.2em] text-[var(--chalk-3)]"
        data-testid="ref-mark-summary"
      >
        <span data-testid="ref-summary-marked">
          <span className="font-mono tabular text-[var(--chalk-0)]">
            {marked}
          </span>{" "}
          of{" "}
          <span className="font-mono tabular text-[var(--chalk-1)]">
            {roster.length}
          </span>{" "}
          marked
        </span>
        <span className="text-[var(--ink-5)]">·</span>
        <span data-testid="ref-summary-late">
          <span className="font-mono tabular text-[var(--amber)]">{late}</span>{" "}
          late
        </span>
        <span className="text-[var(--ink-5)]">·</span>
        <span data-testid="ref-summary-missing">
          <span className="font-mono tabular text-[var(--flare)]">
            {missing}
          </span>{" "}
          missing
        </span>
      </div>

      {/* Grid of tiles */}
      <ul
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        data-testid="ref-mark-grid"
      >
        {roster.map((r) => {
          const photo = getPlayerAvatarUrl(r.gamer_tag);
          const isPresent = r.status === "present";
          const isLate = r.status === "late";
          const isAbsent = r.status === "absent";
          return (
            <li
              key={r.player_id}
              className="flex flex-col gap-3 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-4"
              data-testid={`ref-tile-${r.player_id}`}
            >
              <div className="flex items-center gap-3">
                <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-3)]">
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={photo}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="font-display text-lg font-bold text-[var(--chalk-2)]">
                      {r.display_name.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-base font-semibold text-[var(--chalk-0)]">
                    {r.display_name}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--chalk-3)]">
                    {r.jersey_number != null ? (
                      <span className="font-mono tabular">
                        #{r.jersey_number}
                      </span>
                    ) : null}
                    {r.gamer_tag ? (
                      <span className="truncate font-mono">{r.gamer_tag}</span>
                    ) : null}
                  </div>
                </div>
              </div>

              {r.status ? (
                <div
                  className="text-[11px] uppercase tracking-[0.18em] text-[var(--chalk-3)]"
                  data-testid={`ref-tile-last-${r.player_id}`}
                >
                  Marked{" "}
                  <span
                    className={
                      "font-semibold " +
                      (isPresent
                        ? "text-[var(--signal)]"
                        : isLate
                          ? "text-[var(--amber)]"
                          : "text-[var(--flare)]")
                    }
                  >
                    {r.status.toUpperCase()}
                  </span>
                  {r.marked_at ? (
                    <>
                      {" "}
                      at{" "}
                      <span className="font-mono tabular text-[var(--chalk-1)]">
                        {formatWat(r.marked_at, "HH:mm")}
                      </span>
                    </>
                  ) : null}
                  {r.marked_by_name ? (
                    <>
                      {" "}
                      by{" "}
                      <span className="text-[var(--chalk-1)]">
                        {r.marked_by_name}
                      </span>
                    </>
                  ) : null}
                </div>
              ) : (
                <div
                  className="text-[11px] uppercase tracking-[0.18em] text-[var(--chalk-3)]"
                  data-testid={`ref-tile-last-${r.player_id}`}
                >
                  Not yet marked
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                {r.mark_id ? (
                  <>
                    {/* Existing mark → use editAction with a canned reason. */}
                    <form action={editAction}>
                      <input type="hidden" name="markId" value={r.mark_id} />
                      <input
                        type="hidden"
                        name="matchDayId"
                        value={matchDayId}
                      />
                      <input type="hidden" name="newStatus" value="present" />
                      <input
                        type="hidden"
                        name="reason"
                        value="ref grid: change to present"
                      />
                      <button
                        type="submit"
                        data-testid={`ref-btn-present-${r.player_id}`}
                        className={
                          "min-h-[44px] w-full rounded-sm border px-3 py-2 text-sm font-bold uppercase tracking-[0.2em] transition-colors " +
                          (isPresent
                            ? "border-[var(--signal)] bg-[var(--signal)] text-[var(--signal-ink)]"
                            : "border-[var(--ink-4)] text-[var(--chalk-1)] hover:border-[var(--signal)] hover:text-[var(--signal)]")
                        }
                      >
                        Present
                      </button>
                    </form>
                    <form action={editAction}>
                      <input type="hidden" name="markId" value={r.mark_id} />
                      <input
                        type="hidden"
                        name="matchDayId"
                        value={matchDayId}
                      />
                      <input type="hidden" name="newStatus" value="late" />
                      <input
                        type="hidden"
                        name="reason"
                        value="ref grid: change to late"
                      />
                      <button
                        type="submit"
                        data-testid={`ref-btn-late-${r.player_id}`}
                        className={
                          "min-h-[44px] w-full rounded-sm border px-3 py-2 text-sm font-bold uppercase tracking-[0.2em] transition-colors " +
                          (isLate
                            ? "border-[var(--amber)] bg-[var(--amber)] text-[#2a1a00]"
                            : "border-[var(--ink-4)] text-[var(--chalk-1)] hover:border-[var(--amber)] hover:text-[var(--amber)]")
                        }
                      >
                        Late
                      </button>
                    </form>
                  </>
                ) : (
                  <>
                    {/* No mark yet → markAction. */}
                    <form action={markAction}>
                      <input
                        type="hidden"
                        name="matchDayId"
                        value={matchDayId}
                      />
                      <input
                        type="hidden"
                        name="playerId"
                        value={r.player_id}
                      />
                      <input type="hidden" name="status" value="present" />
                      <button
                        type="submit"
                        data-testid={`ref-btn-present-${r.player_id}`}
                        className="min-h-[44px] w-full rounded-sm border border-[var(--ink-4)] px-3 py-2 text-sm font-bold uppercase tracking-[0.2em] text-[var(--chalk-1)] transition-colors hover:border-[var(--signal)] hover:text-[var(--signal)]"
                      >
                        Present
                      </button>
                    </form>
                    <form action={markAction}>
                      <input
                        type="hidden"
                        name="matchDayId"
                        value={matchDayId}
                      />
                      <input
                        type="hidden"
                        name="playerId"
                        value={r.player_id}
                      />
                      <input type="hidden" name="status" value="late" />
                      <button
                        type="submit"
                        data-testid={`ref-btn-late-${r.player_id}`}
                        className="min-h-[44px] w-full rounded-sm border border-[var(--ink-4)] px-3 py-2 text-sm font-bold uppercase tracking-[0.2em] text-[var(--chalk-1)] transition-colors hover:border-[var(--amber)] hover:text-[var(--amber)]"
                      >
                        Late
                      </button>
                    </form>
                  </>
                )}
              </div>
              {isAbsent ? (
                <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--flare)]">
                  Previously absent — tap Present or Late to override.
                </div>
              ) : null}
            </li>
          );
        })}
        {roster.length === 0 ? (
          <li className="col-span-full rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-10 text-center text-sm text-[var(--chalk-3)]">
            No participants in this season.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
