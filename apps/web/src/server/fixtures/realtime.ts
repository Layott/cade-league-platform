/**
 * Live-refresh (2026-04-24) — fixtures Realtime push helper.
 *
 * Companion to `server/standings/realtime.ts`. The public `/fixtures`
 * page mirrors `/standings` in audience + behaviour: viewers watch
 * during match day and expect scores / match-day publish toggles /
 * re-ordering to appear without a manual reload.
 *
 * Channel topic: `public:fixtures:<seasonId>`
 * Event name:    `fixtures.changed`
 *
 * Publish sites (all fire-and-forget):
 *   - enterResultAction / editResultAction / confirmResultAction
 *     (match result entry)
 *   - addFixtureAction / editMatchAction / removeMatchAction
 *     (fixture CRUD inside a match day)
 *   - publishMatchDayAction / unpublishMatchDayAction
 *     (match-day visibility)
 *   - reorderMatchAction (announce order change)
 *
 * A broadcast failure must never bubble into the write path; the DB
 * row is the durable record.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const FIXTURES_EVENT_CHANGED = "fixtures.changed" as const;

export function fixturesChannelName(seasonId: string): string {
  return `public:fixtures:${seasonId}`;
}

export type FixturesChangedPayload = {
  seasonId: string;
  reason:
    | "result_entered"
    | "result_edited"
    | "result_confirmed"
    | "match_added"
    | "match_edited"
    | "match_removed"
    | "match_reordered"
    | "match_day_published"
    | "match_day_unpublished";
  at: string;
};

export type PublishResult = "ok" | "timed out" | "error";

export async function publishFixturesChanged(
  sb: SupabaseClient,
  seasonId: string,
  reason: FixturesChangedPayload["reason"],
  at: Date = new Date(),
): Promise<PublishResult> {
  const channel = sb.channel(fixturesChannelName(seasonId));
  try {
    const status = (await channel.send({
      type: "broadcast",
      event: FIXTURES_EVENT_CHANGED,
      payload: {
        seasonId,
        reason,
        at: at.toISOString(),
      } satisfies FixturesChangedPayload,
    })) as unknown as PublishResult;
    return status ?? "ok";
  } finally {
    try {
      await sb.removeChannel(channel);
    } catch {
      // best-effort
    }
  }
}

/**
 * Lookup helper — when a mutation knows a matchId but not the
 * seasonId (e.g. reorderMatchAction takes matchDayId), resolve the
 * season by joining through `match_days`. Returns null on miss so
 * callers can silently skip the broadcast.
 */
export async function resolveSeasonIdFromMatchDay(
  sb: SupabaseClient,
  matchDayId: string,
): Promise<string | null> {
  try {
    const { data } = await sb
      .from("match_days")
      .select("season_id")
      .eq("id", matchDayId)
      .is("deleted_at", null)
      .maybeSingle();
    return (data as { season_id: string } | null)?.season_id ?? null;
  } catch {
    return null;
  }
}
