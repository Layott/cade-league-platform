"use client";

/**
 * Plan 16 — `useOverlaySound` hook.
 *
 * Plays the sound asset mapped to `slot` whenever `trigger` identity
 * changes (e.g. on each overlay enter). Thin wrapper around an HTML
 * `<audio>` element — no Web Audio graph needed yet.
 *
 * Silent when:
 *   - `slot` is null / undefined / empty
 *   - the url `?mute=1` query is set (operators default overlays mute)
 *   - the design-preview harness disables sound via the `overlay-sound-muted`
 *     `localStorage` key
 *
 * The hook is SSR-safe — returns `{ready:false}` during server render
 * and on first paint before the audio element mounts.
 */

import { useEffect, useRef, useState } from "react";
import { OVERLAY_SOUNDS } from "./overlay-sounds";

export type OverlaySoundSlot =
  | "stinger-intro"
  | "stinger-normal"
  | "stinger-replay"
  | "stinger-goal"
  | "stinger-winner"
  | "whoosh-short"
  | "whoosh-long"
  | "tick-1s"
  | "timer-end"
  | "notification"
  | "logo-thump"
  | null;

/**
 * Resolves a template-facing slot name to the shipped wav URL. Falls
 * back to the closest synthesized substitute (whoosh-* → trigger-*).
 */
export function resolveSoundUrl(slot: OverlaySoundSlot | undefined): string | null {
  if (!slot) return null;
  switch (slot) {
    case "stinger-intro":
      return OVERLAY_SOUNDS.stingers.introLong;
    case "stinger-normal":
      return OVERLAY_SOUNDS.stingers.normal;
    case "stinger-replay":
      return OVERLAY_SOUNDS.stingers.replay;
    case "stinger-goal":
      return OVERLAY_SOUNDS.stingers.goal;
    case "stinger-winner":
      return OVERLAY_SOUNDS.stingers.winner;
    case "whoosh-short":
      return OVERLAY_SOUNDS.ui.triggerIn;
    case "whoosh-long":
      return OVERLAY_SOUNDS.ui.triggerOut;
    case "tick-1s":
      return OVERLAY_SOUNDS.ui.timerTick;
    case "timer-end":
      return OVERLAY_SOUNDS.ui.timerEnd;
    case "notification":
      return OVERLAY_SOUNDS.ui.notification;
    case "logo-thump":
      return OVERLAY_SOUNDS.brand.logoThump;
    default:
      return null;
  }
}

function isMuted(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("mute") === "1") return true;
    if (window.localStorage?.getItem("overlay-sound-muted") === "1") return true;
  } catch {
    // Private-mode browsers throw on localStorage — fail closed (muted).
    return true;
  }
  return false;
}

export function useOverlaySound(
  slot: OverlaySoundSlot | undefined,
  trigger: unknown,
): { ready: boolean; muted: boolean; url: string | null } {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [ready, setReady] = useState(false);
  const [muted, setMuted] = useState(true);

  const url = resolveSoundUrl(slot);

  // Mount the <audio> element once per slot url. Detaches when slot
  // changes or the component unmounts.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!url) {
      audioRef.current = null;
      setReady(false);
      return;
    }
    const el = new Audio(url);
    el.preload = "auto";
    audioRef.current = el;
    setReady(true);
    setMuted(isMuted());
    return () => {
      el.pause();
      audioRef.current = null;
    };
  }, [url]);

  // Play on trigger changes only — not on first mount, so SSR-hydrated
  // overlays stay silent until the realtime event arrives.
  const firstRunRef = useRef(true);
  useEffect(() => {
    if (firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }
    const el = audioRef.current;
    if (!el) return;
    if (isMuted()) {
      setMuted(true);
      return;
    }
    setMuted(false);
    // Restart sound on re-trigger so repeat goals still punch.
    try {
      el.currentTime = 0;
      void el.play();
    } catch {
      /* autoplay blocked — silent-fail */
    }
  }, [trigger]);

  return { ready, muted, url };
}
