/**
 * Audit Slice 3 (2026-04-24) — standings Realtime push helper.
 *
 * Companion module to `apps/web/src/server/broadcast/realtime.ts`
 * (which handles per-session overlay channels). This module owns the
 * *public* standings channel, which is a separate topic — anon viewers
 * on `/standings` + authenticated players on `/profile` subscribe to
 * receive a wake-up whenever `recompute_standings()` runs.
 *
 * The canonical source of broadcasts is the DB function itself (see
 * `supabase/migrations/20260518000100_standings_realtime_push.sql`).
 * This TS helper exists for:
 *   1. Code paths that recompute standings via the API layer and need
 *      to fire a manual broadcast (e.g. seed scripts, backfill tools,
 *      or admin "force recompute" buttons that bypass the trigger).
 *   2. Unit-test parity with `broadcast/realtime.ts`.
 *
 * Channel naming + event name MUST match the SQL migration so clients
 * can subscribe by topic + event without caring which side fired.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const STANDINGS_EVENT_CHANGED = "standings.changed" as const;

export function standingsChannelName(seasonId: string): string {
  return `public:standings:${seasonId}`;
}

export type PublishResult = "ok" | "timed out" | "error";

export type StandingsChangedPayload = {
  seasonId: string;
  at: string;
};

/**
 * Publishes `standings.changed` on `public:standings:<seasonId>` from
 * the server side. Mirrors the DB-side `realtime.send()` call in the
 * recompute_standings function — either side fires, clients see the
 * same event.
 *
 * Fire-and-forget: the standings row is the durable record. A failed
 * broadcast should never bubble up and block the caller.
 */
export async function publishStandingsChanged(
  sb: SupabaseClient,
  seasonId: string,
  at: Date = new Date(),
): Promise<PublishResult> {
  const channel = sb.channel(standingsChannelName(seasonId));
  try {
    const status = (await channel.send({
      type: "broadcast",
      event: STANDINGS_EVENT_CHANGED,
      payload: {
        seasonId,
        at: at.toISOString(),
      } satisfies StandingsChangedPayload,
    })) as unknown as PublishResult;
    return status ?? "ok";
  } finally {
    try {
      await sb.removeChannel(channel);
    } catch {
      // best-effort cleanup
    }
  }
}
