"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import {
  APPEALS_ADMIN_CHANNEL,
  APPEAL_EVENT_SUBMITTED,
} from "@/server/appeals/realtime";

/**
 * Live-refresh (2026-04-24) — subscriber for `/admin/appeals`. Joins
 * `public:appeals:admin` on mount and re-runs the server render when
 * a player submits an appeal. Channel is unscoped (one admin queue);
 * the SSR query filter handles any future division split.
 */
export function AppealsLiveRefresh(): null {
  const router = useRouter();

  useEffect(() => {
    const sb = getBrowserSupabase();
    const channel = sb.channel(APPEALS_ADMIN_CHANNEL, {
      config: { broadcast: { self: false } },
    });

    channel
      .on("broadcast", { event: APPEAL_EVENT_SUBMITTED }, () => {
        router.refresh();
      })
      .subscribe();

    return () => {
      sb.removeChannel(channel);
    };
  }, [router]);

  return null;
}
