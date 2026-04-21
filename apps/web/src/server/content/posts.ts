import type { SupabaseClient } from "@supabase/supabase-js";
import {
  submitPostSchema,
  verifyPostSchema,
  rejectPostSchema,
  type SubmitPostInput,
  type VerifyPostInput,
  type RejectPostInput,
} from "./schemas";
import { isMonday } from "./week";

export class ContentPostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentPostError";
  }
}

export type ContentPostRow = {
  id: string;
  player_id: string;
  week_start: string;
  platform: "twitter" | "instagram" | "tiktok" | "youtube";
  post_url: string;
  submitted_at: string;
  verified_by_user_id: string | null;
  verification_status: "pending" | "verified" | "rejected";
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

/**
 * Player submits a post URL for a weekly obligation. Idempotent — if the same
 * (player, week, platform, url) already exists (regardless of status), we
 * return the existing row instead of inserting a duplicate.
 */
export async function submitPost(
  sb: SupabaseClient,
  raw: SubmitPostInput,
): Promise<ContentPostRow> {
  const input = submitPostSchema.parse(raw);

  if (!isMonday(input.weekStart)) {
    throw new ContentPostError(
      `weekStart ${input.weekStart} must fall on a Monday (WAT)`,
    );
  }

  const { data: existing, error: exErr } = await sb
    .from("content_posts")
    .select("*")
    .eq("player_id", input.playerId)
    .eq("week_start", input.weekStart)
    .eq("platform", input.platform)
    .eq("post_url", input.postUrl)
    .is("deleted_at", null)
    .maybeSingle();
  if (exErr) throw new ContentPostError(`submit check: ${exErr.message}`);
  if (existing) return existing as ContentPostRow;

  const { data, error } = await sb
    .from("content_posts")
    .insert({
      player_id: input.playerId,
      week_start: input.weekStart,
      platform: input.platform,
      post_url: input.postUrl,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new ContentPostError(`submit: ${error?.message ?? "unknown"}`);
  }
  return data as ContentPostRow;
}

export async function verify(
  sb: SupabaseClient,
  raw: VerifyPostInput,
): Promise<ContentPostRow> {
  const input = verifyPostSchema.parse(raw);
  const { data, error } = await sb
    .from("content_posts")
    .update({
      verification_status: "verified",
      verified_by_user_id: input.verifiedByUserId,
      rejection_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.postId)
    .select("*")
    .single();
  if (error || !data) {
    throw new ContentPostError(`verify: ${error?.message ?? "unknown"}`);
  }
  return data as ContentPostRow;
}

export async function reject(
  sb: SupabaseClient,
  raw: RejectPostInput,
): Promise<ContentPostRow> {
  const input = rejectPostSchema.parse(raw);
  const { data, error } = await sb
    .from("content_posts")
    .update({
      verification_status: "rejected",
      verified_by_user_id: input.verifiedByUserId,
      rejection_reason: input.reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.postId)
    .select("*")
    .single();
  if (error || !data) {
    throw new ContentPostError(`reject: ${error?.message ?? "unknown"}`);
  }
  return data as ContentPostRow;
}

export async function listPending(
  sb: SupabaseClient,
  limit = 50,
): Promise<ContentPostRow[]> {
  const { data, error } = await sb
    .from("content_posts")
    .select("*")
    .eq("verification_status", "pending")
    .is("deleted_at", null)
    .order("submitted_at", { ascending: true })
    .limit(limit);
  if (error) throw new ContentPostError(`listPending: ${error.message}`);
  return (data ?? []) as ContentPostRow[];
}

export async function listForPlayerWeek(
  sb: SupabaseClient,
  playerId: string,
  weekStart: string,
): Promise<ContentPostRow[]> {
  const { data, error } = await sb
    .from("content_posts")
    .select("*")
    .eq("player_id", playerId)
    .eq("week_start", weekStart)
    .is("deleted_at", null)
    .order("submitted_at", { ascending: true });
  if (error) throw new ContentPostError(`listForPlayerWeek: ${error.message}`);
  return (data ?? []) as ContentPostRow[];
}
