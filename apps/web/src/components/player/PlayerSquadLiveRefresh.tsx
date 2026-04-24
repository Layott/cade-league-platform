"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import {
  playerSquadChannelName,
  SQUAD_EVENT_STATUS_CHANGED,
} from "@/server/squads/realtime";

/**
 * Live-refresh (2026-04-24) — subscriber for `/player/squad`. Joins
 * `public:squad:<playerId>:<weekStartDate>` on mount and re-runs the
 * server render when admin approves, rejects, or reopens the
 * submission.
 *
 * Scoped per-player + per-week so no cross-talk between players or
 * week navigation stales the listener.
 */
export function PlayerSquadLiveRefresh({
  playerId,
  weekStartDate,
}: {
  playerId: string | null;
  weekStartDate: string | null;
}): null {
  const router = useRouter();

  useEffect(() => {
    if (!playerId || !weekStartDate) return;

    const sb = getBrowserSupabase();
    const channel = sb.channel(
      playerSquadChannelName(playerId, weekStartDate),
      { config: { broadcast: { self: false } } },
    );

    channel
      .on("broadcast", { event: SQUAD_EVENT_STATUS_CHANGED }, () => {
        router.refresh();
      })
      .subscribe();

    return () => {
      sb.removeChannel(channel);
    };
  }, [playerId, weekStartDate, router]);

  return null;
}
