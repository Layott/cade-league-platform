/**
 * Plan 16 — shared motion tokens.
 *
 * Every overlay consumes timings + easings from this module so the
 * production broadcast surface moves with a single cohesive rhythm.
 * Inline `duration:` literals in `(overlay)/` and `components/overlay/`
 * subtrees are forbidden — bring them through here instead.
 *
 * Bezier values locked after reviewing `KNOWLEDGE/brand-assets/videos/*.mp4`.
 * See `docs/superpowers/specs/plan-16-design-language.md` for per-video
 * sampling notes.
 */

export const ENTER = {
  duration: 0.45,
  ease: [0.22, 1, 0.36, 1], // ease-out-quint — confident push in
} as const;

export const EXIT = {
  duration: 0.25,
  ease: [0.64, 0, 0.78, 0], // ease-in-quint — snap exit, no lingering
} as const;

export const STAGGER = 0.06; // 60 ms between cascading children

export const SCORE_FLIP = {
  duration: 0.6,
  ease: [0.68, -0.55, 0.27, 1.55], // anticipate + overshoot — "ding" on goal
} as const;

export const IDLE_PULSE = {
  duration: 2.4,
  ease: [0.4, 0, 0.6, 1],
  repeat: Infinity,
  repeatType: "mirror" as const,
};

// Stinger motion — full-screen transitions with sound.
export const STINGER_IN = {
  duration: 0.35,
  ease: [0.85, 0, 0.15, 1], // ease-in-out-expo — whip in
} as const;

export const STINGER_HOLD = {
  duration: 1.3, // middle hold for 2s stinger; intro stinger overrides
} as const;

export const STINGER_OUT = {
  duration: 0.35,
  ease: [0.85, 0, 0.15, 1],
} as const;

/**
 * Runtime speed multiplier. `/overlay/design-preview` writes
 * `--motion-speed: <n>` on the document root; production overlays leave
 * it unset (defaults to 1×). SSR-safe: returns the untouched duration
 * server-side.
 */
export function scaleDuration(d: number): number {
  if (typeof window === "undefined") return d;
  if (typeof document === "undefined") return d;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(
    "--motion-speed",
  );
  const speed = Number(raw);
  return Number.isFinite(speed) && speed > 0 ? d / speed : d;
}

export const MOTION_TOKENS = {
  ENTER,
  EXIT,
  STAGGER,
  SCORE_FLIP,
  IDLE_PULSE,
  STINGER_IN,
  STINGER_HOLD,
  STINGER_OUT,
} as const;

export type MotionTokenKey = keyof typeof MOTION_TOKENS;
