/**
 * Live-refresh (2026-04-24) — squad submission Realtime push helpers.
 *
 * Two topics are used:
 *   - `public:squads:<weekStartDate>` fires `squad.submitted` when a
 *     player submits a new squad. Admin queue page (`/admin/squads`)
 *     subscribes and calls `router.refresh()`.
 *   - `public:squad:<playerId>:<weekStartDate>` fires
 *     `squad.status_changed` when the admin approves / rejects /
 *     reopens the player's submission. The player page
 *     (`/player/squad`) subscribes to the scoped topic.
 *
 * Pattern mirrors `server/standings/realtime.ts`: fire-and-forget from
 * the server action after the mutation lands. A broadcast failure must
 * never block the write — the durable record is the DB row.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const SQUAD_EVENT_SUBMITTED = "squad.submitted" as const;
export const SQUAD_EVENT_STATUS_CHANGED = "squad.status_changed" as const;

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
