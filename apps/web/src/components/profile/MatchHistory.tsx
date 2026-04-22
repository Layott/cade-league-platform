import Link from "next/link";
import { formatWat } from "@/lib/time";

// TODO (plan 41 P41-D): import from server/profile/playerStats
export type MatchHistoryRow = {
  matchId: string;
  matchDate: string; // ISO
  opponent: string;
  opponentGamerTag: string | null;
  homeScore: number | null;
  awayScore: number | null;
  playerWasHome: boolean;
  result: "W" | "D" | "L" | null; // null = not yet played or voided
  resultType: string | null;
};

/**
 * Plan 41 — paginated per-match history for one player across the active
 * season. Renders as a dense admin-idiom table at lg, stacks on mobile.
 * Pagination uses URL param `?mh=N` so the page scroll behaviour is
 * preserved (server-rendered, no client state).
 */
export function MatchHistory({
  rows,
  page,
  pageCount,
  baseHref,
}: {
  rows: MatchHistoryRow[];
  page: number;
  pageCount: number;
  baseHref: string;
}) {
  return (
    <section
      className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)]"
      data-testid="match-history"
    >
      <header className="flex items-end justify-between gap-3 border-b border-[var(--ink-4)] bg-[var(--ink-1)] px-5 py-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--chalk-3)]">
            Match history
          </div>
          <h2 className="mt-1 font-display text-lg font-bold text-[var(--chalk-0)]">
            Every fixture this season
          </h2>
        </div>
        <span className="text-[10px] font-mono tabular uppercase tracking-[0.18em] text-[var(--chalk-3)]">
          Page {page} / {Math.max(1, pageCount)}
        </span>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="match-history-table">
          <thead>
            <tr className="border-b border-[var(--ink-4)] bg-[var(--ink-3)]/60 text-[10px] uppercase tracking-[0.22em] text-[var(--chalk-3)]">
              <th scope="col" className="px-4 py-2.5 text-left font-semibold">
                Date
              </th>
              <th scope="col" className="px-4 py-2.5 text-left font-semibold">
                Opponent
              </th>
              <th scope="col" className="px-4 py-2.5 text-center font-semibold">
                Venue
              </th>
              <th scope="col" className="px-4 py-2.5 text-center font-semibold">
                Score
              </th>
              <th scope="col" className="px-4 py-2.5 text-center font-semibold">
                Result
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                Match
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-sm text-[var(--chalk-3)]"
                >
                  No matches played yet this season.
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => (
                <MatchRow key={r.matchId} row={r} zebra={idx % 2 === 1} />
              ))
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 ? (
        <Pagination page={page} pageCount={pageCount} baseHref={baseHref} />
      ) : null}
    </section>
  );
}

function MatchRow({ row, zebra }: { row: MatchHistoryRow; zebra: boolean }) {
  const resultBadge = resultPill(row);
  const venueLabel = row.playerWasHome ? "H" : "A";
  let dateLabel = "";
  try {
    dateLabel = formatWat(row.matchDate, "yyyy-MM-dd");
  } catch {
    dateLabel = row.matchDate.slice(0, 10);
  }
  const scoreText =
    row.homeScore == null || row.awayScore == null
      ? "–"
      : `${row.homeScore}–${row.awayScore}`;
  return (
    <tr
      className={
        "border-b border-[var(--ink-4)]/70 last:border-b-0 hover:bg-[var(--ink-3)]/60 " +
        (zebra ? "bg-[var(--ink-3)]/30" : "")
      }
      data-testid="match-history-row"
    >
      <td className="px-4 py-3 align-middle">
        <span className="font-mono text-xs tabular text-[var(--chalk-1)]">
          {dateLabel}
        </span>
      </td>
      <td className="px-4 py-3 align-middle">
        <div className="flex flex-col">
          <span className="font-display text-[13px] font-semibold leading-tight text-[var(--chalk-0)]">
            {row.opponent}
          </span>
          {row.opponentGamerTag ? (
            <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--chalk-3)]">
              @{row.opponentGamerTag}
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-4 py-3 text-center align-middle">
        <span
          className={
            "inline-flex h-6 w-6 items-center justify-center rounded-sm border font-display text-[11px] font-bold " +
            (row.playerWasHome
              ? "border-[var(--signal)]/50 bg-[var(--signal)]/10 text-[var(--signal)]"
              : "border-[var(--ink-4)] bg-[var(--ink-3)] text-[var(--chalk-2)]")
          }
          title={row.playerWasHome ? "Home" : "Away"}
        >
          {venueLabel}
        </span>
      </td>
      <td className="px-4 py-3 text-center align-middle">
        <span className="tabular font-display text-sm font-semibold text-[var(--chalk-0)]">
          {scoreText}
        </span>
      </td>
      <td className="px-4 py-3 text-center align-middle">{resultBadge}</td>
      <td className="px-4 py-3 text-right align-middle">
        <Link
          href={`/matches/${row.matchId}`}
          className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)] underline decoration-[var(--ink-5)] underline-offset-4 hover:text-[var(--signal)] hover:decoration-[var(--signal)]"
          data-testid="match-history-link"
        >
          View →
        </Link>
      </td>
    </tr>
  );
}

function resultPill(row: MatchHistoryRow) {
  if (row.resultType === "void") {
    return (
      <span className="inline-flex items-center rounded-sm border border-[var(--ink-4)] bg-[var(--ink-3)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
        Void
      </span>
    );
  }
  if (!row.result) {
    return (
      <span className="inline-flex items-center rounded-sm border border-[var(--ink-4)] bg-[var(--ink-3)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
        —
      </span>
    );
  }
  const tone =
    row.result === "W"
      ? "border-[var(--signal)] bg-[var(--signal)]/15 text-[var(--signal)]"
      : row.result === "L"
        ? "border-[var(--flare)]/50 bg-[var(--flare)]/10 text-[var(--flare)]"
        : "border-[var(--amber)]/60 bg-[var(--amber)]/10 text-[var(--amber)]";
  return (
    <span
      className={
        "inline-flex h-6 w-6 items-center justify-center rounded-sm border font-display text-[11px] font-bold " +
        tone
      }
      data-testid={`match-history-result-${row.result}`}
    >
      {row.result}
    </span>
  );
}

function Pagination({
  page,
  pageCount,
  baseHref,
}: {
  page: number;
  pageCount: number;
  baseHref: string;
}) {
  const sep = baseHref.includes("?") ? "&" : "?";
  const hrefFor = (n: number) => `${baseHref}${sep}mh=${n}`;
  const prev = Math.max(1, page - 1);
  const next = Math.min(pageCount, page + 1);
  const atFirst = page <= 1;
  const atLast = page >= pageCount;
  return (
    <nav
      className="flex items-center justify-between gap-2 border-t border-[var(--ink-4)] bg-[var(--ink-1)] px-5 py-3"
      data-testid="match-history-pagination"
      aria-label="Match history pagination"
    >
      <PageLink href={hrefFor(prev)} disabled={atFirst} label="← Prev" />
      <span className="font-mono text-[11px] tabular text-[var(--chalk-2)]">
        Page {page} of {pageCount}
      </span>
      <PageLink href={hrefFor(next)} disabled={atLast} label="Next →" />
    </nav>
  );
}

function PageLink({
  href,
  disabled,
  label,
}: {
  href: string;
  disabled: boolean;
  label: string;
}) {
  const base =
    "inline-flex items-center rounded-sm border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] transition-colors";
  if (disabled) {
    return (
      <span
        className={
          base +
          " cursor-not-allowed border-[var(--ink-4)] bg-[var(--ink-2)] text-[var(--chalk-3)] opacity-60"
        }
        aria-disabled="true"
      >
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={
        base +
        " border-[var(--ink-4)] bg-[var(--ink-2)] text-[var(--chalk-1)] hover:border-[var(--signal)] hover:text-[var(--signal)]"
      }
    >
      {label}
    </Link>
  );
}
