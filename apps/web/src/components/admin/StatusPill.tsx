import type { ReactNode } from "react";

/**
 * StatusPill renders a colored status chip used across the admin console.
 * One color map owns all admin + domain statuses so we stay visually
 * consistent. Unknown tones fall back to `neutral` (chalk).
 */

type Tone =
  | "neutral"
  | "signal"
  | "amber"
  | "flare"
  | "crimson"
  | "muted";

const TONE_STYLES: Record<Tone, string> = {
  neutral:
    "border-[var(--ink-4)] bg-[var(--ink-3)] text-[var(--chalk-1)]",
  signal:
    "border-[rgba(0,255,136,0.35)] bg-[rgba(0,255,136,0.1)] text-[var(--signal)]",
  amber:
    "border-[rgba(255,176,32,0.35)] bg-[rgba(255,176,32,0.1)] text-[var(--amber)]",
  flare:
    "border-[rgba(255,91,59,0.35)] bg-[rgba(255,91,59,0.1)] text-[var(--flare)]",
  crimson:
    "border-[rgba(220,38,38,0.4)] bg-[rgba(220,38,38,0.1)] text-[#ff7070]",
  muted:
    "border-[var(--ink-4)] bg-transparent text-[var(--chalk-3)]",
};

const STATUS_TONES: Record<string, Tone> = {
  // match + result lifecycle
  scheduled: "neutral",
  in_progress: "amber",
  live: "amber",
  completed: "signal",
  confirmed: "signal",
  final: "signal",
  draft: "amber",
  forfeited: "flare",
  forfeit: "flare",
  void: "muted",
  voided: "muted",
  active: "signal",
  revoked: "muted",

  // attendance
  present: "signal",
  late: "amber",
  absent: "flare",

  // sanction types
  warning: "neutral",
  point_deduction: "amber",
  gd_deduction: "amber",
  ban: "crimson",

  // announcement priorities
  info: "neutral",
  important: "amber",
  urgent: "flare",

  // announcement lifecycle
  published: "signal",
  draft_ann: "amber",
};

export function tonefor(status: string): Tone {
  const tone = STATUS_TONES[status.toLowerCase()];
  return tone ?? "neutral";
}

export function StatusPill({
  status,
  tone,
  children,
  uppercase = true,
  className = "",
  ...rest
}: {
  status?: string;
  tone?: Tone;
  children?: ReactNode;
  uppercase?: boolean;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLSpanElement>, "children">) {
  const resolvedTone = tone ?? (status ? tonefor(status) : "neutral");
  const label = children ?? status?.replace(/_/g, " ") ?? "";
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[10px] font-semibold tracking-[0.16em] " +
        (uppercase ? "uppercase " : "") +
        TONE_STYLES[resolvedTone] +
        " " +
        className
      }
      {...rest}
    >
      {resolvedTone === "signal" ? (
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full bg-[var(--signal)] pulse-dot"
        />
      ) : null}
      {label}
    </span>
  );
}
