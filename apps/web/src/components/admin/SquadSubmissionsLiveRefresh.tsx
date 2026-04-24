"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import {
  squadsAdminChannelName,
  SQUAD_EVENT_SUBMITTED,
} from "@/server/squads/realtime";

/**
 * Live-refresh (2026-04-24) — subscriber for the admin squad queue at
 * `/admin/squads`. Joins `public:squads:<weekStartDate>` on mount and
 * re-runs the server render whenever a player submits a new squad.
 *
 * The `weekStartDate` is scoped so switching the week filter in the
 * query string also switches the channel — admins only see live pings
 * for the week they're looking at.
 */
export function SquadSubmissionsLiveRefresh({
  weekStartDate,
}: {
  weekStartDate: string;
}): null {
  const router = useRouter();

  useEffect(() => {
    if (!weekStartDate) return;

    const sb = getBrowserSupabase();
    const channel = sb.channel(squadsAdminChannelName(weekStartDate), {
      config: { broadcast: { self: false } },
    });

    channel
      .on("broadcast", { event: SQUAD_EVENT_SUBMITTED }, () => {
        router.refresh();
      })
      .subscribe();

    return () => {
      sb.removeChannel(channel);
    };
  }, [weekStartDate, router]);

  return null;
}
