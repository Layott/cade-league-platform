import Image from "next/image";
import { formatWat } from "@/lib/time";
import { getPlayerAvatarUrl } from "@/lib/player-photos";

export type FixtureRow = {
  id: string;
  scheduled_time: string | null;
  status: string;
  home_name: string;
  home_tag: string;
  home_jersey: number | null;
  away_name: string;
  away_tag: string;
  away_jersey: number | null;
  home_score: number | null;
  away_score: number | null;
  result_type: string | null;
  confirmed_at: string | null;
};

export type FixtureGroup = {
  id: string;
  match_date: string;
  match_start_time: string;
  arrival_cutoff_time: string;
  venue_name: string | null;
  status: string;
  fixtures: FixtureRow[];
};

const STATUS_TONES: Record<string, { label: string; cls: string }> = {
  scheduled: {
    label: "Scheduled",
    cls: "border-[var(--ink-5)] text-[var(--chalk-1)]",
  },
  in_progress: {
    label: "Live",
    cls: "border-[var(--signal)] text-[var(--signal)] bg-[var(--signal)]/10",
  },
  completed: {
    label: "Final",
    cls: "border-[var(--signal)] text-[var(--signal)]",
  },
  forfeited: {
    label: "Forfeit",
    cls: "border-[var(--flare)]/60 text-[var(--flare)] bg-[var(--flare)]/10",
  },
  void: {
    label: "Void",
    cls: "border-[var(--chalk-3)] text-[var(--chalk-3)]",
  },
};

function statusTone(status: string) {
  return STATUS_TONES[status] ?? STATUS_TONES.scheduled;
}

function formatClock(t: string | null): string {
  if (!t) return "TBD";
  // Handles both HH:MM:SS and ISO timestamps.
  if (/^\d{2}:\d{2}/.test(t)) return t.slice(0, 5);
  try {
    return formatWat(t, "HH:mm");
  } catch {
    return t;
  }
}

export function FixtureList({ groups }: { groups: FixtureGroup[] }) {
  return (
    <div className="space-y-10">
      {groups.map((g) => (
        <MatchDayBlock key={g.id} group={g} />
      ))}
    </div>
  );
}

function MatchDayBlock({ group }: { group: FixtureGroup }) {
  const date = `${group.match_date}T00:00:00`;
  const tone = statusTone(group.status);
  return (
    <section
      className="group relative overflow-hidden rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]"
      data-testid="fixture-group"
    >
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 w-1 bg-[var(--signal)]"
      />
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-[var(--ink-4)] bg-[var(--ink-1)] px-6 py-5">
        <div className="flex items-center gap-5">
          <div className="flex flex-col items-center justify-center rounded-sm border border-[var(--ink-5)] bg-[var(--ink-2)] px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--chalk-3)]">
              {formatWat(date, "MMM")}
            </div>
            <div className="font-display text-3xl font-bold leading-none text-[var(--chalk-0)]">
              {formatWat(date, "dd")}
            </div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--signal)]">
              {formatWat(date, "EEE")}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--chalk-3)]">
              Match day
            </div>
            <h2 className="mt-1 font-display text-2xl font-bold text-[var(--chalk-0)]">
              {group.venue_name ?? "Venue TBD"}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[var(--chalk-2)]">
              <MetaChip
                label="Kick-off"
                value={`${formatClock(group.match_start_time)} WAT`}
              />
              <MetaChip
                label="Arrival by"
                value={`${formatClock(group.arrival_cutoff_time)} WAT`}
              />
              <MetaChip
                label="Fixtures"
                value={group.fixtures.length.toString().padStart(2, "0")}
              />
            </div>
          </div>
        </div>
        <span
          className={
            "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em] " +
            tone.cls
          }
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
          {tone.label}
        </span>
      </header>

      <ul
        className="divide-y divide-[var(--ink-4)]"
        data-testid="fixture-list"
      >
        {group.fixtures.length === 0 ? (
          <li className="px-6 py-8 text-center text-sm text-[var(--chalk-3)]">
            Fixture list pending draw.
          </li>
        ) : (
          group.fixtures.map((f) => <FixtureRowCard key={f.id} fixture={f} />)
        )}
      </ul>
    </section>
  );
}

function FixtureRowCard({ fixture: f }: { fixture: FixtureRow }) {
  const hasScore =
    f.home_score !== null && f.away_score !== null && f.confirmed_at !== null;
  const tone = statusTone(f.status);
  const homeWin = hasScore && (f.home_score ?? 0) > (f.away_score ?? 0);
  const awayWin = hasScore && (f.away_score ?? 0) > (f.home_score ?? 0);

  return (
    <li
      className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-6 py-4 transition-colors hover:bg-[var(--ink-3)]/50 md:gap-8"
      data-testid="fixture-row"
    >
      <TeamSide
        name={f.home_name}
        tag={f.home_tag}
        jersey={f.home_jersey}
        won={homeWin}
        align="right"
      />

      <div className="flex min-w-[140px] flex-col items-center">
        {hasScore ? (
          <div className="tabular font-display text-3xl font-bold text-[var(--chalk-0)]">
            <span className={homeWin ? "text-[var(--signal)]" : ""}>
              {f.home_score}
            </span>
            <span className="mx-2 text-[var(--chalk-3)]">–</span>
            <span className={awayWin ? "text-[var(--signal)]" : ""}>
              {f.away_score}
            </span>
          </div>
        ) : (
          <div className="tabular font-display text-xl font-semibold text-[var(--chalk-1)]">
            {formatClock(f.scheduled_time)}
          </div>
        )}
        <span
          className={
            "mt-2 inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.22em] " +
            tone.cls
          }
        >
          {tone.label}
          {f.result_type === "forfeit" ? (
            <span className="ml-1 text-[var(--flare)]">F</span>
          ) : null}
        </span>
      </div>

      <TeamSide
        name={f.away_name}
        tag={f.away_tag}
        jersey={f.away_jersey}
        won={awayWin}
        align="left"
      />
    </li>
  );
}

function TeamSide({
  name,
  tag,
  jersey,
  won,
  align,
}: {
  name: string;
  tag: string;
  jersey: number | null;
  won: boolean;
  align: "left" | "right";
}) {
  const justify = align === "right" ? "justify-end" : "justify-start";
  const text = align === "right" ? "text-right" : "text-left";
  const ring = won ? "ring-2 ring-[var(--signal)]" : "ring-1 ring-[var(--ink-5)]";
  const initials = initialsFrom(name);
  const photoUrl = getPlayerAvatarUrl(tag);
  return (
    <div className={"flex min-w-0 items-center gap-3 " + justify}>
      {align === "left" ? (
        <PlayerMini
          photoUrl={photoUrl}
          initials={initials}
          ring={ring}
          won={won}
          name={name}
        />
      ) : null}
      <div className={"min-w-0 " + text}>
        <div className="truncate font-display text-[15px] font-semibold leading-tight text-[var(--chalk-0)]">
          {name}
        </div>
        <div
          className={
            "mt-0.5 text-[10px] uppercase tracking-[0.22em] " +
            (won ? "text-[var(--signal)]" : "text-[var(--chalk-3)]")
          }
        >
          @{tag}
        </div>
      </div>
      {align === "right" ? (
        <PlayerMini
          photoUrl={photoUrl}
          initials={initials}
          ring={ring}
          won={won}
          name={name}
        />
      ) : null}
      {/* Jersey tile retained as a small badge alongside the avatar. */}
      {jersey != null ? (
        <span
          className="hidden items-center justify-center rounded-sm border border-[var(--ink-5)] bg-[var(--ink-1)] px-1.5 py-0.5 font-display text-[10px] font-bold tabular text-[var(--chalk-2)] sm:inline-flex"
          aria-hidden
        >
          #{jersey}
        </span>
      ) : null}
    </div>
  );
}

function PlayerMini({
  photoUrl,
  initials,
  ring,
  won,
  name,
}: {
  photoUrl: string | null;
  initials: string;
  ring: string;
  won: boolean;
  name: string;
}) {
  return (
    <div
      className={
        "relative flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded-full bg-[var(--ink-1)] " +
        ring
      }
      data-testid="fixture-player-mini"
    >
      {photoUrl ? (
        <Image
          src={photoUrl}
          alt={name}
          width={36}
          height={36}
          className="h-full w-full object-cover"
        />
      ) : (
        <span
          className={
            "font-display text-[11px] font-bold " +
            (won ? "text-[var(--signal)]" : "text-[var(--chalk-2)]")
          }
        >
          {initials}
        </span>
      )}
    </div>
  );
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[var(--chalk-3)]">
        {label}
      </span>
      <span className="tabular text-[12px] font-medium text-[var(--chalk-1)]">
        {value}
      </span>
    </span>
  );
}

function initialsFrom(name: string): string {
  return (
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}
