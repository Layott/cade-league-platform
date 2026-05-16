"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * Drop-in `useState` replacement that snapshots to localStorage on every
 * change and hydrates from it on mount. Used by every operator-facing
 * control card in `/admin/broadcast/v2/[sessionId]` so the per-card
 * inputs (player picks, scores, kickoff times, match selections, etc.)
 * survive the `router.refresh()` ControlGrid fires on every Realtime
 * overlay event.
 *
 * Before this hook landed, every trigger from any control wiped the
 * operator's in-progress entries on every OTHER control because
 * router.refresh() remounted the page tree. With persistence the React
 * tree still remounts but the state restores from localStorage in the
 * lazy-initializer.
 *
 * Key convention: `v2-<overlayKey>:<sessionId>:<field>` so swapping
 * sessions or overlays doesn't drag stale state across.
 *
 * No serialization plug points — the value must be JSON-serialisable.
 */
export function usePersistedState<T>(
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return initial;
      const parsed = JSON.parse(raw) as T;
      // Light validity check — if parsed is null/undefined, fall back.
      return parsed == null ? initial : parsed;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* quota exceeded or storage blocked — best-effort */
    }
  }, [key, state]);

  return [state, setState];
}
