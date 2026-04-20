import Link from "next/link";
import { formatWat } from "@/lib/time";
import { EmptyState } from "@/components/public/EmptyState";
import type { HomeMatchDay } from "@/server/homepage";

/** Arrival cutoff is stored as a Postgres "time" string (HH:MM:SS). We
 * format it as "HH:MM" by trimming seconds. For richer formatting we'd need
 * a date anchor — keep it simple. */
function formatCutoff(t: string): string {
  const [h, m] = t.split(":");
  return `${h}:${m}`;
}

export function UpcomingMatchDayCard({
  matchDay,
}: {
  matchDay: HomeMatchDay | null;
}) {
  if (!matchDay) {
    return (
      <EmptyState
        title="No match day locked in"
        hint={
          <>
            The next fixture release will drop here. Check{" "}
            <Link href="/announcements" className="underline decoration-[var(--signal)] underline-offset-4">
              News
            </Link>{" "}
            for schedule announcements.
          </>
        }
      />
    );
  }

  const matchDate = `${matchDay.match_date}T00:00:00`;
  return (
    <article className="group relative overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-6 transition-colors hover:border-[var(--signal)]">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-1 bg-[var(--signal)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-[var(--signal-glow)] opacity-0 blur-3xl transition-opacity group-hover:opacity-100"
      />

      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--signal)]">
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full bg-[var(--signal)] pulse-dot"
        />
        Next match day
      </div>

      <div className="mt-3 grid grid-cols-[auto_1fr] items-end gap-5">
        <div className="flex flex-col items-center justify-center rounded-sm border border-[var(--ink-5)] bg-[var(--ink-1)] px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--chalk-3)]">
            {formatWat(matchDate, "MMM")}
          </div>
          <div className="font-display text-4xl font-bold leading-none text-[var(--chalk-0)]">
            {formatWat(matchDate, "dd")}
          </div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--signal)]">
            {formatWat(matchDate, "EEE")}
          </div>
        </div>

        <div>
          <div className="font-display text-xl font-bold leading-tight text-[var(--chalk-0)]">
            {matchDay.venue_name ?? "Venue to be announced"}
          </div>
          <div className="mt-1 text-sm text-[var(--chalk-2)]">
            Kick-off{" "}
            <span className="tabular text-[var(--chalk-0)]">
              {formatCutoff(matchDay.match_start_time)}
            </span>{" "}
            WAT
          </div>
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-3 divide-x divide-[var(--ink-4)] rounded-sm border border-[var(--ink-4)] bg-[var(--ink-1)]">
        <Stat
          label="Arrival by"
          value={formatCutoff(matchDay.arrival_cutoff_time)}
          hint="WAT"
        />
        <Stat
          label="Fixtures"
          value={String(matchDay.fixture_count).padStart(2, "0")}
          hint={matchDay.fixture_count === 1 ? "match" : "matches"}
        />
        <Stat label="Status" value="Scheduled" hint="Locked" />
      </dl>

      <Link
        href="/fixtures"
        className="mt-6 inline-flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em] text-[var(--signal)] transition-transform hover:translate-x-0.5"
      >
        View fixtures
        <span aria-hidden>→</span>
      </Link>
    </article>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--chalk-3)]">
        {label}
      </dt>
      <dd className="tabular text-xl font-bold text-[var(--chalk-0)]">
        {value}
      </dd>
      <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--chalk-3)]">
        {hint}
      </div>
    </div>
  );
}
