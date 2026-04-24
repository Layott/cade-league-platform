"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import {
  playerAppealsChannelName,
  APPEAL_EVENT_RULED,
} from "@/server/appeals/realtime";

/**
 * Live-refresh (2026-04-24) — subscriber for `/player/appeals`. Joins
 * `public:appeal:<userId>` on mount and re-runs the server render on
 * any ruling / withdrawal affecting the viewing player.
 */
export function PlayerAppealsLiveRefresh({
  userId,
}: {
  userId: string | null;
}): null {
  const router = useRouter();

  useEffect(() => {
    if (!userId) return;

    const sb = getBrowserSupabase();
    const channel = sb.channel(playerAppealsChannelName(userId), {
      config: { broadcast: { self: false } },
    });

    channel
      .on("broadcast", { event: APPEAL_EVENT_RULED }, () => {
        router.refresh();
      })
      .subscribe();

    return () => {
      sb.removeChannel(channel);
    };
  }, [userId, router]);

  return null;
}
