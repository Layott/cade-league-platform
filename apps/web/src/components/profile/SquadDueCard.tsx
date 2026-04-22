import Link from "next/link";
import { formatWat } from "@/lib/time";
import type { SquadStatus } from "@/server/profile/squadStatus";
import { SquadDueCountdown } from "./SquadDueCountdown";

/**
 * Plan 41 — P41-F — 200px dashboard card mounted at top of /player.
 * Presents the current squad-due state with a live countdown (pre-deadline)
 * and a context-appropriate CTA.
 */
export function SquadDueCard({ status }: { status: SquadStatus }) {
  const title = cardTitle(status);
  const subtitle = cardSubtitle(status);
  const tone = cardTone(status);
  const cta = cardCta(status);

  return (
    <section
      data-testid="squad-due-card"
      data-status-kind={status.kind}
      className={
        "flex min-h-[200px] flex-col justify-between rounded-sm border p-5 " +
        tone.card
      }
    >
      <div className="space-y-2">
        <div
          className={
            "text-[10px] font-semibold uppercase tracking-[0.3em] " + tone.eyebrow
          }
        >
          Squad submission
        </div>
        <h2 className="font-display text-[22px] font-bold leading-tight tracking-tight text-[var(--chalk-0)]">
          {title}
        </h2>
        {subtitle ? (
          <p className="text-sm leading-relaxed text-[var(--chalk-2)]">
            {subtitle}
          </p>
        ) : null}
      </div>

      <div className="flex items-end justify-between gap-4 pt-4">
        {status.kind === "pre_deadline" ? (
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--chalk-3)]">
              Time remaining
            </span>
            <SquadDueCountdown
              deadlineIso={status.deadline.toISOString()}
              className="text-2xl"
            />
          </div>
        ) : (
          <div />
        )}
        {cta ? (
          <Link
            href={cta.href}
            data-testid="squad-due-card-cta"
            className={
              "inline-flex items-center justify-center rounded-sm px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] transition-colors " +
              tone.cta
            }
          >
            {cta.label}
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function cardTitle(status: SquadStatus): string {
  switch (status.kind) {
    case "pre_deadline":
      return `Squad due in ${status.hoursUntil} hr${status.hoursUntil === 1 ? "" : "s"}`;
    case "submitted_pending":
      return "Squad submitted — awaiting review";
    case "submitted_approved":
      return "Squad approved — GL!";
    case "submitted_rejected":
      return "Squad rejected — resubmit required";
    case "window_closed":
      return "Window closed — waiting for match day";
    case "friday_change_window":
      return status.changesRemaining > 0
        ? "Friday change window — one swap allowed"
        : "Friday change window — swap already used";
    case "reopened_by_admin":
      return "Submission reopened by admin";
  }
}

function cardSubtitle(status: SquadStatus): string | null {
  switch (status.kind) {
    case "pre_deadline":
      return `Deadline Thursday ${formatWat(status.deadline, "HH:mm")} WAT (${formatWat(status.deadline, "yyyy-MM-dd")}).`;
    case "submitted_pending":
      return "An admin will validate your squad against this week's rules.";
    case "submitted_approved":
      return "Good luck this match day. Friday 21:00 WAT opens a one-swap window.";
    case "submitted_rejected":
      return status.reason ? `Reason: ${status.reason}` : "Check with an admin for details.";
    case "window_closed":
      return "The submission window has closed. Friday change window opens at 21:00 WAT.";
    case "friday_change_window":
      return "Window open 21:00-22:00 WAT. You may swap one player with a referee's approval.";
    case "reopened_by_admin":
      return `Reopened ${formatWat(status.reopenedAt, "yyyy-MM-dd HH:mm")} WAT. Resubmit your squad.`;
  }
}

type CardCta = { href: string; label: string } | null;
function cardCta(status: SquadStatus): CardCta {
  switch (status.kind) {
    case "pre_deadline":
    case "submitted_rejected":
    case "reopened_by_admin":
      return { href: "/player/squad", label: "Submit now →" };
    case "submitted_pending":
    case "submitted_approved":
    case "window_closed":
      return { href: "/player/squad", label: "View squad" };
    case "friday_change_window":
      return status.changesRemaining > 0
        ? { href: "/player/squad/change", label: "Request swap →" }
        : { href: "/player/squad", label: "View squad" };
  }
}

type Tone = { card: string; eyebrow: string; cta: string };
function cardTone(status: SquadStatus): Tone {
  switch (status.kind) {
    case "pre_deadline":
      return {
        card: "border-[var(--signal)]/40 bg-[var(--ink-2)]",
        eyebrow: "text-[var(--signal)]",
        cta: "bg-[var(--signal)] text-[var(--ink-0)] hover:brightness-110",
      };
    case "submitted_pending":
      return {
        card: "border-[var(--ink-4)] bg-[var(--ink-2)]",
        eyebrow: "text-[var(--chalk-3)]",
        cta: "bg-[var(--ink-3)] text-[var(--chalk-0)] hover:bg-[var(--ink-4)]",
      };
    case "submitted_approved":
      return {
        card: "border-[var(--signal)]/40 bg-[var(--ink-2)]",
        eyebrow: "text-[var(--signal)]",
        cta: "bg-[var(--ink-3)] text-[var(--chalk-0)] hover:bg-[var(--ink-4)]",
      };
    case "submitted_rejected":
    case "reopened_by_admin":
      return {
        card: "border-[var(--flare)]/50 bg-[var(--ink-2)]",
        eyebrow: "text-[var(--flare)]",
        cta: "bg-[var(--flare)] text-[var(--ink-0)] hover:brightness-110",
      };
    case "window_closed":
      return {
        card: "border-[var(--ink-4)] bg-[var(--ink-2)]",
        eyebrow: "text-[var(--chalk-3)]",
        cta: "bg-[var(--ink-3)] text-[var(--chalk-0)] hover:bg-[var(--ink-4)]",
      };
    case "friday_change_window":
      return {
        card: "border-[var(--signal)]/40 bg-[var(--ink-2)]",
        eyebrow: "text-[var(--signal)]",
        cta: "bg-[var(--signal)] text-[var(--ink-0)] hover:brightness-110",
      };
  }
}
