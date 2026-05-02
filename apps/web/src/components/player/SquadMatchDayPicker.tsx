import Link from "next/link";
import { StatusPill } from "@/components/admin/StatusPill";
import { formatWat } from "@/lib/time";

/**
 * Plan 56 — match-day-scoped squad picker for `/player/squad`.
 *
 * Shows EVERY match day in the active season as a row with a status pill +
 * action CTA. Replaces the "open match days only" CTA list that shipped in
 * the original `/player/squad` because players need to view past
 * submissions + plan upcoming ones, not just file for the currently-open
 * match day.
 *
 * Status taxonomy (per row):
 *   - "submitted"   → player has a live (not soft-deleted) submission for
 *                     this match day. CTA: View squad.
 *   - "open"        → window resolves open + no submission. CTA: Submit.
 *   - "closed"      → window resolves closed (deadline passed, league
 *                     force-close, or admin force-close) + no submission.
 *                     CTA: Closed (info card on detail view).
 *   - "upcoming"    → match day is in the future + admin has not yet
 *                     opened the window. CTA: Coming up.
 *
 * Grouping: matches are bucketed into Past / This week / Upcoming based on
 * the WAT-anchored Thursday week boundaries. The current week's MD is
 * highlighted with a subtle accent so the player's eye lands on the row
 * they're most likely to act on.
 */

export type SquadMatchDayPickerStatus =
  | "submitted"
  | "open"
  | "closed"
  | "upcoming";

export type SquadMatchDayPickerItem = {
  matchDayId: string;
  matchDate: string; // YYYY-MM-DD (the primary / first match day in the group)
  venueName: string;
  status: SquadMatchDayPickerStatus;
  submittedAt?: string | null;
  validationStatus?: "pending" | "approved" | "rejected" | null;
  windowOpensAt?: string | null;
  /**
   * 2026-05-01 — bug 6. When status==='submitted' AND windowOpen===true AND
   * validationStatus==='pending', the row swaps the "View squad" CTA for
   * "Edit squad" so a player can revise before the deadline. Plumbed
   * through from the page-level `r.isOpen` resolver. Defaults to false at
   * render time so legacy / unspecified rows behave like before.
   */
  windowOpen?: boolean;
  /**
   * 2026-05-02 — "edit always when window open" extension.
   *
   * `forceOpen=true` means the open state was reached through an explicit
   * admin (per-match-day OR per-week) force-open. In that case the picker
   * shows "Edit squad" even when the submission is rejected / approved,
   * because admin force-open is the signal that the player should be
   * able to revise. When `forceOpen=false` (window is open through the
   * ambient pre-deadline default) the legacy gate still applies — only
   * pending submissions get the Edit CTA.
   */
  forceOpen?: boolean;
  bucket: "past" | "this_week" | "upcoming";
  // 2026-04-30 — weekend grouping. When a weekend has BOTH Sat + Sun match
  // days, the page aggregates them into ONE row pointing at the Sat
  // matchDayId (which carries the same squad submission since the two
  // share a Thursday-anchor week). `displayLabel` is "May 2-3" for the
  // pair or "May 23" when only one date falls in the weekend; replaces
  // the raw matchDate as the visible header. `secondaryMatchDate` is the
  // Sun (or absent) match-date string used for the smaller sublabel.
  displayLabel?: string;
  secondaryMatchDate?: string | null;
};

export type SquadMatchDayPickerProps = {
  items: SquadMatchDayPickerItem[];
  currentMatchDayId?: string | null;
};

function pillFor(item: SquadMatchDayPickerItem) {
  if (item.status === "submitted") {
    // Surface the validation status at a glance — pending / approved / rejected.
    if (item.validationStatus === "approved") {
      return <StatusPill tone="primary">Approved</StatusPill>;
    }
    if (item.validationStatus === "rejected") {
      return <StatusPill tone="flare">Rejected</StatusPill>;
    }
    return <StatusPill tone="primary">Submitted</StatusPill>;
  }
  if (item.status === "open") {
    return <StatusPill tone="primary">Submission open</StatusPill>;
  }
  if (item.status === "closed") {
    return <StatusPill tone="muted">Closed</StatusPill>;
  }
  return <StatusPill tone="sky">Coming up</StatusPill>;
}

function ctaFor(item: SquadMatchDayPickerItem) {
  const href = `/player/squad?matchDay=${encodeURIComponent(item.matchDayId)}`;
  const editHref = `${href}&edit=1`;
  const baseCls =
    "inline-flex items-center justify-center rounded-sm px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors";
  if (item.status === "submitted") {
    // 2026-05-01 — bug 6 (extended 2026-05-02 — "edit-always-when-window-
    // open"). Surface "Edit squad" whenever the window is open AND the
    // player can resubmit. Two cases:
    //   1. Window open via ambient pre-deadline default — only pending
    //      submissions are editable (legacy behaviour). Approved /
    //      rejected go through the admin reopen path.
    //   2. Window open via explicit admin force-open (per-match-day or
    //      per-week) — ALL statuses are editable. Force-open is the
    //      signal that the admin wants the player to revise, regardless
    //      of prior approval/rejection. The submit.ts re-submit gate
    //      mirrors this branching.
    // Otherwise fall back to the read-only "View squad" CTA.
    const editable =
      item.windowOpen === true &&
      (item.forceOpen === true ||
        item.validationStatus === "pending");
    if (editable) {
      return (
        <Link
          href={editHref}
          className={`${baseCls} border border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-ink)] hover:bg-[#82e21a]`}
          data-testid={`md-cta-edit-${item.matchDayId}`}
        >
          Edit squad
        </Link>
      );
    }
    return (
      <Link
        href={href}
        className={`${baseCls} border border-[var(--ink-4)] bg-[var(--ink-1)] text-[var(--chalk-1)] hover:border-[var(--primary)] hover:text-[var(--primary)]`}
        data-testid={`md-cta-view-${item.matchDayId}`}
      >
        View squad
      </Link>
    );
  }
  if (item.status === "open") {
    return (
      <Link
        href={href}
        className={`${baseCls} border border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-ink)] hover:bg-[#82e21a]`}
        data-testid={`md-cta-submit-${item.matchDayId}`}
      >
        Submit squad
      </Link>
    );
  }
  if (item.status === "closed") {
    return (
      <Link
        href={href}
        className={`${baseCls} border border-[var(--ink-4)] bg-transparent text-[var(--chalk-3)] hover:text-[var(--chalk-1)]`}
        data-testid={`md-cta-closed-${item.matchDayId}`}
      >
        Window closed
      </Link>
    );
  }
  return (
    <Link
      href={href}
      className={`${baseCls} border border-[var(--ink-4)] bg-transparent text-[var(--chalk-3)] hover:text-[var(--chalk-1)]`}
      data-testid={`md-cta-upcoming-${item.matchDayId}`}
    >
      Coming up
    </Link>
  );
}

function Row({
  item,
  isCurrent,
}: {
  item: SquadMatchDayPickerItem;
  isCurrent: boolean;
}) {
  return (
    <li
      key={item.matchDayId}
      data-testid={`squad-match-day-row-${item.matchDayId}`}
      data-status={item.status}
      className={
        "flex flex-wrap items-center justify-between gap-3 rounded-sm border p-3 " +
        (isCurrent
          ? "border-[rgba(107,205,6,0.45)] bg-[rgba(107,205,6,0.06)]"
          : "border-[var(--ink-4)] bg-[var(--ink-2)]")
      }
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <span className="font-display text-sm font-semibold text-[var(--chalk-0)]">
            {item.displayLabel
              ? `Weekend · ${item.displayLabel}`
              : item.matchDate}
          </span>
          {pillFor(item)}
        </div>
        <div className="text-[11px] text-[var(--chalk-2)]">
          {item.displayLabel
            ? `${item.matchDate}${item.secondaryMatchDate ? ` + ${item.secondaryMatchDate}` : ""} · `
            : null}
          {item.venueName}
          {item.status === "submitted" && item.submittedAt
            ? ` · Submitted ${formatWat(item.submittedAt, "yyyy-MM-dd HH:mm")} WAT`
            : null}
        </div>
      </div>
      {ctaFor(item)}
    </li>
  );
}

export function SquadMatchDayPicker({
  items,
  currentMatchDayId,
}: SquadMatchDayPickerProps) {
  if (items.length === 0) {
    return (
      <section
        data-testid="squad-match-day-picker-empty"
        className="rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] p-6 text-center text-sm text-[var(--chalk-3)]"
      >
        No match days have been scheduled yet for this season.
      </section>
    );
  }

  const past = items.filter((i) => i.bucket === "past");
  const thisWeek = items.filter((i) => i.bucket === "this_week");
  const upcoming = items.filter((i) => i.bucket === "upcoming");

  return (
    <section
      data-testid="squad-match-day-picker"
      className="space-y-6"
    >
      {thisWeek.length > 0 ? (
        <div data-testid="squad-md-bucket-this-week">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--primary)]">
            This week
          </h3>
          <ul className="flex flex-col gap-2">
            {thisWeek.map((it) => (
              <Row
                key={it.matchDayId}
                item={it}
                // Highlight every "this week" row (only one normally) so the
                // player's eye lands here. Falls back to explicit selection
                // when caller pinned a different MD.
                isCurrent={
                  currentMatchDayId == null ||
                  currentMatchDayId === it.matchDayId
                }
              />
            ))}
          </ul>
        </div>
      ) : null}

      {upcoming.length > 0 ? (
        <div data-testid="squad-md-bucket-upcoming">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Upcoming
          </h3>
          <ul className="flex flex-col gap-2">
            {upcoming.map((it) => (
              <Row
                key={it.matchDayId}
                item={it}
                isCurrent={currentMatchDayId === it.matchDayId}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {past.length > 0 ? (
        <div data-testid="squad-md-bucket-past">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--chalk-3)]">
            Past
          </h3>
          <ul className="flex flex-col gap-2">
            {past.map((it) => (
              <Row
                key={it.matchDayId}
                item={it}
                isCurrent={currentMatchDayId === it.matchDayId}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
