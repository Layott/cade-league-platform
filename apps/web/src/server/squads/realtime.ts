/**
 * Live-refresh (2026-04-24) — squad submission Realtime push helpers.
 *
 * Three topics are used:
 *   - `public:squads:<weekStartDate>` fires `squad.submitted` when a
 *     player submits a new squad. Admin queue page (`/admin/squads`)
 *     subscribes and calls `router.refresh()`.
 *   - `public:squad:<playerId>:<weekStartDate>` fires
 *     `squad.status_changed` when the admin approves / rejects /
 *     reopens the player's submission. The player page
 *     (`/player/squad`) subscribes to the scoped topic.
 *   - `public:standings:<seasonId>` fires `squad.updated` when a player
 *     submits / re-submits / applies a squad to multiple match days
 *     (added 2026-05-02). Broadcast overlays (e.g. 19-player-squads)
 *     subscribe via the standings channel — they already do for
 *     `standings.changed` — so a single channel drives both
 *     standings + squad repaints mid-stream. Fired alongside the
 *     existing `squad.submitted` so admin/player UI flows are
 *     untouched.
 *
 * Pattern mirrors `server/standings/realtime.ts`: fire-and-forget from
 * the server action after the mutation lands. A broadcast failure must
 * never block the write — the durable record is the DB row.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const SQUAD_EVENT_SUBMITTED = "squad.submitted" as const;
export const SQUAD_EVENT_STATUS_CHANGED = "squad.status_changed" as const;
// 2026-05-02 — fired on the public:standings:<seasonId> channel so
// broadcast overlays (which already subscribe to standings.changed for
// the same channel) repaint when a squad submission lands. Distinct
// from squad.submitted (which lives on a per-week admin topic) so
// overlay subscribers don't have to track every weekly anchor.
export const SQUAD_EVENT_UPDATED = "squad.updated" as const;

export function squadsAdminChannelName(weekStartDate: string): string {
  return `public:squads:${weekStartDate}`;
}

export function playerSquadChannelName(
  playerId: string,
  weekStartDate: string,
): string {
  return `public:squad:${playerId}:${weekStartDate}`;
}

export type SquadSubmittedPayload = {
  weekStartDate: string;
  playerId: string;
  submissionId: string;
  at: string;
};

export type SquadStatusChangedPayload = {
  playerId: string;
  weekStartDate: string;
  submissionId: string;
  status: "pending" | "approved" | "rejected" | "reopened";
  at: string;
};

export type PublishResult = "ok" | "timed out" | "error";

export async function publishSquadSubmitted(
  sb: SupabaseClient,
  payload: Omit<SquadSubmittedPayload, "at">,
  at: Date = new Date(),
): Promise<PublishResult> {
  const channel = sb.channel(squadsAdminChannelName(payload.weekStartDate));
  try {
    const status = (await channel.send({
      type: "broadcast",
      event: SQUAD_EVENT_SUBMITTED,
      payload: { ...payload, at: at.toISOString() } satisfies SquadSubmittedPayload,
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

export async function publishSquadStatusChanged(
  sb: SupabaseClient,
  payload: Omit<SquadStatusChangedPayload, "at">,
  at: Date = new Date(),
): Promise<PublishResult> {
  const channel = sb.channel(
    playerSquadChannelName(payload.playerId, payload.weekStartDate),
  );
  try {
    const status = (await channel.send({
      type: "broadcast",
      event: SQUAD_EVENT_STATUS_CHANGED,
      payload: {
        ...payload,
        at: at.toISOString(),
      } satisfies SquadStatusChangedPayload,
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

export type SquadUpdatedPayload = {
  seasonId: string;
  playerId: string;
  matchDayId: string | null;
  weekStartDate: string;
  submissionId: string;
  at: string;
};

/**
 * 2026-05-02 — fire `squad.updated` on the public standings channel for
 * the season so any overlay subscriber (notably 19-player-squads via
 * `OverlayDataInjector`'s `REALTIME_KEY_EVENTS` map) repaints with the
 * fresh roster. Same channel as `standings.changed` so overlays don't
 * need to open a new subscription per topic.
 *
 * Fire-and-forget: the squad_submissions row is the durable record. A
 * dropped broadcast is harmless — the next ambient poll or the next
 * standings.changed event will re-fetch from the seed endpoint.
 */
export function squadStandingsChannelName(seasonId: string): string {
  // Mirrors `apps/web/src/server/overlays/registry.ts::REALTIME.standingsChannel`.
  // Kept inline here so this module has no dependency on the overlays
  // registry package; the string MUST stay in lock-step.
  return `public:standings:${seasonId}`;
}

export async function publishSquadChanged(
  sb: SupabaseClient,
  payload: Omit<SquadUpdatedPayload, "at">,
  at: Date = new Date(),
): Promise<PublishResult> {
  const channel = sb.channel(squadStandingsChannelName(payload.seasonId));
  try {
    const status = (await channel.send({
      type: "broadcast",
      event: SQUAD_EVENT_UPDATED,
      payload: {
        ...payload,
        at: at.toISOString(),
      } satisfies SquadUpdatedPayload,
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
