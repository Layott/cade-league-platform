import Link from "next/link";
import { formatWat } from "@/lib/time";

// TODO (plan 41 P41-D): import from server/squads/week or server/profile/squadStatus
export type SquadStatus =
  | { kind: "pre_deadline"; hoursUntil: number; deadline: string } // deadline ISO
  | { kind: "submitted_pending" }
  | { kind: "submitted_approved" }
  | { kind: "submitted_rejected"; reason: string | null }
  | { kind: "window_closed" }
  | { kind: "friday_change_window"; changesRemaining: number }
  | {
      kind: "reopened_by_admin";
      reopenedAt: string; // ISO
      reopenedBy: string | null;
    };

/**
 * Plan 41 — compact squad-status widget used inside the /profile surface.
 * NOT the full dashboard card (that's `<SquadDueCard />`, out of this
 * agent's lane). Always links to /player/squad.
 */
export function SquadStatusWidget({ status }: { status: SquadStatus }) {
  const cfg = toneFor(status);
  return (
    <section
      className={
        "relative overflow-hidden rounded-sm border bg-[var(--ink-2)] " +
        cfg.borderCls
      }
      data-testid="squad-status-widget"
      data-status-kind={status.kind}
    >
      <div
        aria-hidden
        className={"absolute inset-y-0 left-0 w-1 " + cfg.accentCls}
      />
      <div className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div
            className={
              "text-[10px] font-semibold uppercase tracking-[0.28em] " +
              cfg.eyebrowCls
            }
          >
            Squad
          </div>
          <h2 className="mt-1 font-display text-base font-bold text-[var(--chalk-0)]">
            {cfg.title}
          </h2>
          {cfg.subtitle ? (
            <p className="mt-1 text-xs text-[var(--chalk-2)]">{cfg.subtitle}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {cfg.badge ? (
            <span
              className={
                "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] " +
                cfg.badge.cls
              }
            >
              {cfg.badge.label}
            </span>
          ) : null}
          <Link
            href="/player/squad"
            className={
              "inline-flex items-center justify-center rounded-sm border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] transition-colors " +
              cfg.ctaCls
            }
            data-testid="squad-status-cta"
          >
            {cfg.cta}
          </Link>
        </div>
      </div>
    </section>
  );
}

type ToneConfig = {
  title: string;
  subtitle: string | null;
  cta: string;
  ctaCls: string;
  eyebrowCls: string;
  accentCls: string;
  borderCls: string;
  badge: { label: string; cls: string } | null;
};

function toneFor(s: SquadStatus): ToneConfig {
  switch (s.kind) {
    case "pre_deadline": {
      const urgent = s.hoursUntil <= 6;
      const hrsLabel = formatHoursUntil(s.hoursUntil);
      const deadlineLabel = safeFormatDeadline(s.deadline);
      return {
        title: urgent
          ? `Squad due in ${hrsLabel} — submit now`
          : `Squad due in ${hrsLabel}`,
        subtitle: `Deadline: Thursday ${deadlineLabel} WAT`,
        cta: "Submit →",
        ctaCls: urgent
          ? "border-[var(--amber)] bg-[var(--amber)]/15 text-[var(--amber)] hover:bg-[var(--amber)]/25"
          : "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-ink)] hover:bg-[#82e21a]",
        eyebrowCls: urgent ? "text-[var(--amber)]" : "text-[var(--signal)]",
        accentCls: urgent ? "bg-[var(--amber)]" : "bg-[var(--signal)]",
        borderCls: urgent
          ? "border-[var(--amber)]/40"
          : "border-[var(--ink-4)]",
        badge: urgent
          ? {
              label: "Urgent",
              cls: "border-[var(--amber)]/60 bg-[var(--amber)]/10 text-[var(--amber)]",
            }
          : {
              label: "Open",
              cls: "border-[var(--signal)]/50 bg-[var(--signal)]/10 text-[var(--signal)]",
            },
      };
    }
    case "submitted_pending":
      return {
        title: "Squad submitted — awaiting review",
        subtitle: "An admin will approve or reject shortly.",
        cta: "View",
        ctaCls:
          "border-[var(--ink-4)] bg-[var(--ink-2)] text-[var(--chalk-1)] hover:border-[var(--signal)] hover:text-[var(--signal)]",
        eyebrowCls: "text-[var(--chalk-3)]",
        accentCls: "bg-[var(--chalk-3)]",
        borderCls: "border-[var(--ink-4)]",
        badge: {
          label: "Pending",
          cls: "border-[var(--amber)]/60 bg-[var(--amber)]/10 text-[var(--amber)]",
        },
      };
    case "submitted_approved":
      return {
        title: "Squad approved — GL!",
        subtitle: "No further action required this week.",
        cta: "Review",
        ctaCls:
          "border-[var(--ink-4)] bg-[var(--ink-2)] text-[var(--chalk-1)] hover:border-[var(--signal)] hover:text-[var(--signal)]",
        eyebrowCls: "text-[var(--signal)]",
        accentCls: "bg-[var(--signal)]",
        borderCls: "border-[var(--signal)]/40",
        badge: {
          label: "Approved",
          cls: "border-[var(--signal)] bg-[var(--signal)]/15 text-[var(--signal)]",
        },
      };
    case "submitted_rejected":
      return {
        title: "Squad rejected",
        subtitle: s.reason
          ? `Reason: ${s.reason}`
          : "Resubmit during the Friday change window.",
        cta: "Fix & resubmit",
        ctaCls:
          "border-[var(--flare)] bg-[var(--flare)]/15 text-[var(--flare)] hover:bg-[var(--flare)]/25",
        eyebrowCls: "text-[var(--flare)]",
        accentCls: "bg-[var(--flare)]",
        borderCls: "border-[var(--flare)]/40",
        badge: {
          label: "Rejected",
          cls: "border-[var(--flare)]/60 bg-[var(--flare)]/10 text-[var(--flare)]",
        },
      };
    case "window_closed":
      return {
        title: "Submission window closed",
        subtitle: "Friday change window opens after Thursday deadline.",
        cta: "View",
        ctaCls:
          "border-[var(--ink-4)] bg-[var(--ink-2)] text-[var(--chalk-2)] hover:border-[var(--signal)] hover:text-[var(--signal)]",
        eyebrowCls: "text-[var(--chalk-3)]",
        accentCls: "bg-[var(--chalk-3)]",
        borderCls: "border-[var(--ink-4)]",
        badge: {
          label: "Closed",
          cls: "border-[var(--ink-4)] bg-[var(--ink-3)] text-[var(--chalk-3)]",
        },
      };
    case "friday_change_window":
      return {
        title:
          s.changesRemaining > 0
            ? "Friday change window — one change allowed"
            : "Friday window used",
        subtitle:
          s.changesRemaining > 0
            ? "You may swap one player before kickoff."
            : "No further changes permitted this match day.",
        cta: s.changesRemaining > 0 ? "Make change" : "View",
        ctaCls:
          s.changesRemaining > 0
            ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-ink)] hover:bg-[#82e21a]"
            : "border-[var(--ink-4)] bg-[var(--ink-2)] text-[var(--chalk-2)] hover:border-[var(--signal)] hover:text-[var(--signal)]",
        eyebrowCls: "text-[var(--signal)]",
        accentCls: "bg-[var(--signal)]",
        borderCls: "border-[var(--signal)]/40",
        badge: {
          label: `${s.changesRemaining} left`,
          cls: "border-[var(--signal)]/50 bg-[var(--signal)]/10 text-[var(--signal)]",
        },
      };
    case "reopened_by_admin": {
      const whenLabel = safeFormatDeadline(s.reopenedAt);
      return {
        title: "Submission reopened by admin",
        subtitle: `Please resubmit (reopened ${whenLabel} WAT${
          s.reopenedBy ? ` by ${s.reopenedBy}` : ""
        }).`,
        cta: "Resubmit →",
        ctaCls:
          "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-ink)] hover:bg-[#82e21a]",
        eyebrowCls: "text-[var(--signal)]",
        accentCls: "bg-[var(--signal)]",
        borderCls: "border-[var(--signal)]/40",
        badge: {
          label: "Reopened",
          cls: "border-[var(--signal)]/50 bg-[var(--signal)]/10 text-[var(--signal)]",
        },
      };
    }
  }
}

function formatHoursUntil(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return "soon";
  if (hours < 1) {
    const mins = Math.max(1, Math.round(hours * 60));
    return `${mins} min`;
  }
  if (hours < 24) return `${Math.round(hours)} hr`;
  const days = Math.floor(hours / 24);
  const rem = Math.round(hours - days * 24);
  return rem > 0 ? `${days}d ${rem}hr` : `${days}d`;
}

function safeFormatDeadline(iso: string): string {
  try {
    return formatWat(iso, "HH:mm");
  } catch {
    return iso.slice(11, 16) || iso;
  }
}
