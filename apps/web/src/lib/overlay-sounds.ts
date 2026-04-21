/**
 * Overlay sound registry.
 *
 * Paths resolve from `apps/web/public/overlay/sounds/`. Every file is a
 * 44.1 kHz, stereo, 16-bit PCM WAV synthesized by
 * `scripts/synth-overlay-sounds.mjs` (run via `npm run overlay:synth-sounds`).
 *
 * Keep the shape flat and keyed by overlay-surface so callers can import a
 * single `OVERLAY_SOUNDS.stingers.goal` rather than stringly-typing a URL.
 */

export const OVERLAY_SOUNDS = {
  stingers: {
    introLong: "/overlay/sounds/stingers/intro_long.wav",
    normal: "/overlay/sounds/stingers/stinger_normal.wav",
    replay: "/overlay/sounds/stingers/stinger_replay.wav",
    goal: "/overlay/sounds/stingers/stinger_goal.wav",
    winner: "/overlay/sounds/stingers/stinger_winner.wav",
  },
  ui: {
    timerTick: "/overlay/sounds/ui/timer_tick.wav",
    timerEnd: "/overlay/sounds/ui/timer_end.wav",
    notification: "/overlay/sounds/ui/notification.wav",
    triggerIn: "/overlay/sounds/ui/trigger_in.wav",
    triggerOut: "/overlay/sounds/ui/trigger_out.wav",
  },
  brand: {
    logoThump: "/overlay/sounds/brand/logo_thump.wav",
  },
} as const;

export type OverlaySoundCategory = keyof typeof OVERLAY_SOUNDS;
export type OverlayStingerKey = keyof typeof OVERLAY_SOUNDS.stingers;
export type OverlayUiSoundKey = keyof typeof OVERLAY_SOUNDS.ui;
export type OverlayBrandSoundKey = keyof typeof OVERLAY_SOUNDS.brand;
