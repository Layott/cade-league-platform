/**
 * Live-refresh (2026-04-24) — appeal Realtime push helpers.
 *
 * Channels:
 *   - `public:appeals:admin` — event `appeal.submitted`; the admin
 *     queue at `/admin/appeals` subscribes so a newly-filed appeal
 *     appears without a reload.
 *   - `public:appeal:<userId>` — event `appeal.ruled`; the player's
 *     `/player/appeals` page subscribes under their own userId so the
 *     ruling / withdraw appears without a reload.
 *
 * Same fire-and-forget semantics as `server/standings/realtime.ts`:
 * never let a broadcast failure propagate up and block the mutation.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const APPEAL_EVENT_SUBMITTED = "appeal.submitted" as const;
export const APPEAL_EVENT_RULED = "appeal.ruled" as const;

export const APPEALS_ADMIN_CHANNEL = "public:appeals:admin" as const;

export function playerAppealsChannelName(userId: string): string {
  return `public:appeal:${userId}`;
}

export type AppealSubmittedPayload = {
  appealId: string;
  submittedByUserId: string;
  at: string;
};

export type AppealRuledPayload = {
  appealId: string;
  submittedByUserId: string;
  status: "submitted" | "under_review" | "ruled" | "withdrawn" | "expired";
  at: string;
};

export type PublishResult = "ok" | "timed out" | "error";

export async function publishAppealSubmitted(
  sb: SupabaseClient,
  payload: Omit<AppealSubmittedPayload, "at">,
  at: Date = new Date(),
): Promise<PublishResult> {
  const channel = sb.channel(APPEALS_ADMIN_CHANNEL);
  try {
    const status = (await channel.send({
      type: "broadcast",
      event: APPEAL_EVENT_SUBMITTED,
      payload: { ...payload, at: at.toISOString() } satisfies AppealSubmittedPayload,
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

export async function publishAppealRuled(
  sb: SupabaseClient,
  payload: Omit<AppealRuledPayload, "at">,
  at: Date = new Date(),
): Promise<PublishResult> {
  const channel = sb.channel(playerAppealsChannelName(payload.submittedByUserId));
  try {
    const status = (await channel.send({
      type: "broadcast",
      event: APPEAL_EVENT_RULED,
      payload: { ...payload, at: at.toISOString() } satisfies AppealRuledPayload,
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
