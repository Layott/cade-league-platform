import Link from "next/link";
import type { SquadStatus } from "@/server/profile/squadStatus";
import { SquadDueCountdown } from "./SquadDueCountdown";

/**
 * Plan 41 — P41-F — 40px full-width strip mounted under /player chrome.
 *
 * Spec §6:
 *   - Pre-deadline: green background, shows countdown + "Submit now →" CTA.
 *   - 6 hrs before: amber.
 *   - Post-deadline: rose.
 *   - Not dismissible pre-deadline (always visible until submitted OR window closed).
 *
 * We render `null` when the player is in a terminal state that no longer
 * needs a persistent nag: submitted_approved (nothing to do) and window_closed
 * (waiting-for-match-day is surfaced by the card, banner becomes noise).
 */
export function SquadDueBanner({ status }: { status: SquadStatus }) {
  // Hide banner when submitted_approved or window_closed — card covers those.
  if (status.kind === "submitted_approved" || status.kind === "window_closed") {
    return null;
  }

  const { tone, label, cta } = bannerContent(status);

  return (
    <div
      data-testid="squad-due-banner"
      data-status-kind={status.kind}
      role="status"
      className={
        "flex h-10 w-full items-center justify-between gap-3 border-b px-4 text-[12px] font-semibold " +
        tone
      }
    >
      <div className="flex min-w-0 flex-1 items-center gap-3 truncate">
        <span className="uppercase tracking-[0.2em] opacity-80">Squad</span>
        <span className="truncate">{label}</span>
        {status.kind === "pre_deadline" ? (
          <SquadDueCountdown
            deadlineIso={status.deadline.toISOString()}
            className="text-[12px]"
          />
        ) : null}
      </div>
      {cta ? (
        <Link
          href={cta.href}
          data-testid="squad-due-banner-cta"
          className="shrink-0 whitespace-nowrap underline-offset-4 hover:underline"
        >
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}

function bannerContent(status: SquadStatus): {
  tone: string;
  label: string;
  cta: { href: string; label: string } | null;
} {
  switch (status.kind) {
    case "pre_deadline": {
      // 6 hrs before deadline flips to amber per spec §6.
      const urgent = status.hoursUntil <= 6;
      const tone = urgent
        ? "border-amber-500/60 bg-amber-500/20 text-amber-100"
        : "border-[var(--signal)]/60 bg-[var(--signal)]/20 text-[var(--chalk-0)]";
      return {
        tone,
        label: `Squad due in ${status.hoursUntil} hr${status.hoursUntil === 1 ? "" : "s"} —`,
        cta: { href: "/player/squad", label: "Submit now →" },
      };
    }
    case "submitted_pending":
      return {
        tone: "border-[var(--ink-4)] bg-[var(--ink-2)] text-[var(--chalk-1)]",
        label: "Squad submitted — awaiting admin review.",
        cta: { href: "/player/squad", label: "View →" },
      };
    case "submitted_rejected":
      return {
        tone: "border-[var(--flare)]/60 bg-[var(--flare)]/20 text-[var(--chalk-0)]",
        label: status.reason
          ? `Rejected: ${status.reason} — resubmit required.`
          : "Rejected — resubmit required.",
        cta: { href: "/player/squad", label: "Resubmit →" },
      };
    case "friday_change_window":
      return {
        tone: "border-[var(--signal)]/60 bg-[var(--signal)]/20 text-[var(--chalk-0)]",
        label:
          status.changesRemaining > 0
            ? "Friday change window open — one swap allowed."
            : "Friday change window open — swap already used.",
        cta:
          status.changesRemaining > 0
            ? { href: "/player/squad/change", label: "Request swap →" }
            : null,
      };
    case "reopened_by_admin":
      return {
        tone: "border-[var(--flare)]/60 bg-[var(--flare)]/20 text-[var(--chalk-0)]",
        label: "Submission reopened by admin — resubmit required.",
        cta: { href: "/player/squad", label: "Resubmit →" },
      };
    // Covered by the early-return above but exhaustiveness demands branches.
    case "submitted_approved":
    case "window_closed":
      return {
        tone: "border-[var(--ink-4)] bg-[var(--ink-2)] text-[var(--chalk-1)]",
        label: "",
        cta: null,
      };
  }
}
