import type { ReactNode } from "react";

/**
 * StatusPill renders a colored status chip used across the admin console.
 * One color map owns all admin + domain statuses so we stay visually
 * consistent. Unknown tones fall back to `neutral` (chalk).
 */

type Tone =
  | "neutral"
  | "primary"
  | "signal" // deprecated alias of "primary" — kept for back-compat
  | "secondary"
  | "amber"
  | "flare"
  | "crimson"
  | "muted"
  | "sky"
  | "violet"
  | "teal"
  | "magenta"
  | "lime"
  | "rose"
  | "indigo"
  | "copper";

const PRIMARY_TONE =
  "border-[rgba(107,205,6,0.35)] bg-[rgba(107,205,6,0.1)] text-[var(--primary)]";

const TONE_STYLES: Record<Tone, string> = {
  neutral:
    "border-[var(--ink-4)] bg-[var(--ink-3)] text-[var(--chalk-1)]",
  primary: PRIMARY_TONE,
  // Deprecated alias — renders identically to `primary`. Existing call sites
  // may pass tone="signal" until they migrate.
  signal: PRIMARY_TONE,
  secondary:
    "border-[rgba(254,3,109,0.35)] bg-[rgba(254,3,109,0.1)] text-[var(--secondary)]",
  amber:
    "border-[rgba(255,176,32,0.35)] bg-[rgba(255,176,32,0.1)] text-[var(--amber)]",
  flare:
    "border-[rgba(255,91,59,0.35)] bg-[rgba(255,91,59,0.1)] text-[var(--flare)]",
  crimson:
    "border-[rgba(220,38,38,0.4)] bg-[rgba(220,38,38,0.1)] text-[#ff7070]",
  muted:
    "border-[var(--ink-4)] bg-transparent text-[var(--chalk-3)]",
  // Plan 9 extended tone set — one unique colour per non-admin role so the
  // user-list chips read at a glance. All colours chosen for contrast on
  // the dark brand surface; none collide with existing status tones.
  sky:
    "border-[rgba(86,183,255,0.35)] bg-[rgba(86,183,255,0.1)] text-[#7fc1ff]",
  violet:
    "border-[rgba(171,130,255,0.35)] bg-[rgba(171,130,255,0.1)] text-[#bda3ff]",
  teal:
    "border-[rgba(78,220,198,0.35)] bg-[rgba(78,220,198,0.1)] text-[#7cebd0]",
  magenta:
    "border-[rgba(255,112,204,0.35)] bg-[rgba(255,112,204,0.1)] text-[#ff97d5]",
  lime:
    "border-[rgba(195,240,90,0.35)] bg-[rgba(195,240,90,0.1)] text-[#d6f28d]",
  rose:
    "border-[rgba(255,135,148,0.35)] bg-[rgba(255,135,148,0.1)] text-[#ffa3b0]",
  indigo:
    "border-[rgba(118,132,230,0.35)] bg-[rgba(118,132,230,0.1)] text-[#a3aff1]",
  copper:
    "border-[rgba(216,142,94,0.35)] bg-[rgba(216,142,94,0.1)] text-[#e7b389]",
};

// Role-name → tone map used by the /admin/users role chips. Keep in sync
// with ROLE_NAMES in src/perms.ts.
export const ROLE_TONES: Record<string, Tone> = {
  admin: "signal",
  loc: "amber",
  idc: "copper",
  referee: "sky",
  technical: "violet",
  production: "teal",
  design: "magenta",
  moderator: "lime",
  coach: "indigo",
  team_manager: "rose",
  player: "neutral",
  viewer: "muted",
};

export function roleTone(role: string): Tone {
  return ROLE_TONES[role] ?? "neutral";
}

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

  // broadcast (Plan 12)
  ended: "muted",
  triggered: "signal",
  cleared: "muted",
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
      {resolvedTone === "signal" || resolvedTone === "primary" ? (
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full bg-[var(--primary)] pulse-dot"
        />
      ) : null}
      {label}
    </span>
  );
}
