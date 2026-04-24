"use client";

import { useEffect, useRef, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { REALTIME } from "@/server/overlays/registry";

/**
 * Audit Slice 1 (2026-04-24) — shared Realtime-aware data-feed hook for
 * the leaderboard-animated / top-scorers / match-scores-day overlays.
 *
 * Responsibilities:
 *   1. Initial fetch from a caller-provided `/api/...` endpoint (the
 *      overlay's session-scoped data route, passing `?t=<view_token>`).
 *   2. Subscribe to one OR two Realtime channels — the overlay passes
 *      `{ standings?: string, session?: string }`. Any broadcast on
 *      either channel triggers a re-fetch.
 *   3. Debounce re-fetches (200 ms) so rapid-fire events (e.g. a score
 *      change + standings recompute + another score change) collapse
 *      into a single round-trip.
 *
 * Pattern mirrors `useOverlayChannel` but carries a typed payload (not a
 * schema-erased `Record<string, unknown>`) because data-feed overlays
 * own their own API + shape.
 */

type FetchState<T> = {
  /** Current rendered payload. `null` until the first successful fetch. */
  data: T | null;
  /** True after the initial mount fetch has settled (success or fail). */
  hydrated: boolean;
  /** True after the Realtime subscriber reports SUBSCRIBED. */
  connected: boolean;
  /** Unix-ms timestamp of the last successful fetch. */
  lastFetchAt: number | null;
  /** Monotonic fetch counter — handy for debug HUDs. */
  fetchCount: number;
};

export type DataFeedOptions = {
  /** URL to fetch on mount + on every Realtime event. */
  url: string | null;
  /** Realtime channel topics to subscribe to. */
  channels: {
    standings?: string | null;
    session?: string | null;
  };
  /** Events that trigger a re-fetch. When omitted, uses a default set
   *  covering standings recompute + session match-flow events. */
  events?: string[];
  /** Debounce interval in ms between consecutive re-fetches. Defaults
   *  to 200 ms. */
  debounceMs?: number;
};

const DEFAULT_EVENTS = [
  REALTIME.eventStandingsChanged, // public:standings:*
  REALTIME.eventScoreChanged, // overlay:<sessionId>
  REALTIME.eventMatchStarted, // overlay:<sessionId>
  REALTIME.eventMatchEnded, // overlay:<sessionId>
  REALTIME.eventTriggered, // overlay:<sessionId> — if another admin
  REALTIME.eventSessionEnded, // overlay:<sessionId>
];

export function useDataFeed<T>(
  opts: DataFeedOptions,
  parse: (body: unknown) => T | null,
): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    hydrated: false,
    connected: false,
    lastFetchAt: null,
    fetchCount: 0,
  });

  const optsRef = useRef(opts);
  optsRef.current = opts;
  const parseRef = useRef(parse);
  parseRef.current = parse;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    if (!opts.url) return;

    const debounceMs = opts.debounceMs ?? 200;

    const doFetch = async () => {
      if (inflightRef.current) return;
      const url = optsRef.current.url;
      if (!url) return;
      inflightRef.current = true;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json();
        if (cancelledRef.current) return;
        const parsed = parseRef.current(body);
        setState((s) => ({
          ...s,
          data: parsed,
          hydrated: true,
          lastFetchAt: Date.now(),
          fetchCount: s.fetchCount + 1,
        }));
      } catch {
        // non-fatal — hydration + Realtime will retry on the next event
        setState((s) => ({ ...s, hydrated: true }));
      } finally {
        inflightRef.current = false;
      }
    };

    const scheduleFetch = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void doFetch();
      }, debounceMs);
    };

    // Immediate first fetch — no debounce on mount.
    void doFetch();

    // Subscribe to Realtime channels. We only create channels for
    // non-null topics; both may be null in some unusual dev scenarios.
    const sb = getBrowserSupabase();
    const activeChannels: ReturnType<typeof sb.channel>[] = [];

    const events = opts.events ?? DEFAULT_EVENTS;

    const bindEvents = (ch: ReturnType<typeof sb.channel>) => {
      for (const ev of events) {
        ch.on("broadcast", { event: ev }, () => {
          scheduleFetch();
        });
      }
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setState((s) => ({ ...s, connected: true }));
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setState((s) => ({ ...s, connected: false }));
        }
      });
      activeChannels.push(ch);
    };

    if (opts.channels.standings) {
      bindEvents(
        sb.channel(opts.channels.standings, {
          config: { broadcast: { self: false } },
        }),
      );
    }
    if (opts.channels.session) {
      bindEvents(
        sb.channel(opts.channels.session, {
          config: { broadcast: { self: false } },
        }),
      );
    }

    return () => {
      cancelledRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const ch of activeChannels) {
        try {
          sb.removeChannel(ch);
        } catch {
          /* best-effort */
        }
      }
    };
    // We intentionally don't add opts.channels/events/debounceMs to the
    // deps — callers keep the object reference stable via memoized
    // values (or pass plain strings). Re-subscribing on every render
    // would thrash the Realtime channel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.url, opts.channels.standings, opts.channels.session]);

  return state;
}
