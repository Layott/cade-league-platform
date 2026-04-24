/**
 * Live-refresh (2026-04-24) — dispute Realtime push helpers.
 *
 * Mirror of `server/appeals/realtime.ts`. Channels:
 *   - `public:disputes:admin` — event `dispute.submitted`; the admin
 *     queue at `/admin/disputes` + the admin dashboard's "open disputes"
 *     counter subscribe so a newly-filed dispute appears without
 *     reload.
 *   - `public:dispute:<userId>` — event `dispute.ruled`; the player's
 *     `/player/disputes` page subscribes under their own userId so the
 *     assign / rule transitions appear without reload.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const DISPUTE_EVENT_SUBMITTED = "dispute.submitted" as const;
export const DISPUTE_EVENT_RULED = "dispute.ruled" as const;

export const DISPUTES_ADMIN_CHANNEL = "public:disputes:admin" as const;

export function playerDisputesChannelName(userId: string): string {
  return `public:dispute:${userId}`;
}

export type DisputeSubmittedPayload = {
  disputeId: string;
  raisedByUserId: string;
  at: string;
};

export type DisputeRuledPayload = {
  disputeId: string;
  raisedByUserId: string;
  status: "submitted" | "under_review" | "resolved" | "withdrawn";
  at: string;
};

export type PublishResult = "ok" | "timed out" | "error";

export async function publishDisputeSubmitted(
  sb: SupabaseClient,
  payload: Omit<DisputeSubmittedPayload, "at">,
  at: Date = new Date(),
): Promise<PublishResult> {
  const channel = sb.channel(DISPUTES_ADMIN_CHANNEL);
  try {
    const status = (await channel.send({
      type: "broadcast",
      event: DISPUTE_EVENT_SUBMITTED,
      payload: { ...payload, at: at.toISOString() } satisfies DisputeSubmittedPayload,
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

export async function publishDisputeRuled(
  sb: SupabaseClient,
  payload: Omit<DisputeRuledPayload, "at">,
  at: Date = new Date(),
): Promise<PublishResult> {
  const channel = sb.channel(playerDisputesChannelName(payload.raisedByUserId));
  try {
    const status = (await channel.send({
      type: "broadcast",
      event: DISPUTE_EVENT_RULED,
      payload: { ...payload, at: at.toISOString() } satisfies DisputeRuledPayload,
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
