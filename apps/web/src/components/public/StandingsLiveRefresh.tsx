"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import {
  standingsChannelName,
  STANDINGS_EVENT_CHANGED,
} from "@/server/standings/realtime";

/**
 * Audit Slice 3 (2026-04-24) — live-refresh hook for pages that read
 * from `public.standings` (the public `/standings` table and each
 * player's `/profile` page).
 *
 * Subscribes to `public:standings:<seasonId>` on mount; on every
 * `standings.changed` event, calls `router.refresh()` which re-runs
 * the Server Component's data fetch without a full page reload — the
 * browser replaces the HTML for server-rendered portions while
 * client state stays intact.
 *
 * The SSR pass still renders the initial data for fast first paint;
 * this component only handles live updates.
 *
 * Props:
 *   - `seasonId` — required; mounted only when a season is active.
 *     When `null` the hook is a no-op (keeps the component safe to
 *     drop into pages that may not have an active season).
 */
export function StandingsLiveRefresh({
  seasonId,
}: {
  seasonId: string | null;
}): null {
  const router = useRouter();

  useEffect(() => {
    if (!seasonId) return;

    const sb = getBrowserSupabase();
    const channel = sb.channel(standingsChannelName(seasonId), {
      config: { broadcast: { self: false } },
    });

    channel
      .on(
        "broadcast",
        { event: STANDINGS_EVENT_CHANGED },
        () => {
          // Re-run the server component data fetch. This is a
          // soft refresh: the router rehydrates server-rendered
          // portions of the tree without losing client state.
          router.refresh();
        },
      )
      .subscribe();

    return () => {
      sb.removeChannel(channel);
    };
  }, [seasonId, router]);

  return null;
}
