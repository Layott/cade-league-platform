"use server";

import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { create, publishNow, schedulePublish } from "@/server/announcements";

function parseChannels(formData: FormData): string[] {
  const channels: string[] = [];
  if (formData.get("channel_in_app") === "on") channels.push("in_app");
  if (formData.get("channel_email") === "on") channels.push("email");
  return channels;
}

function parseAudience(formData: FormData): {
  audience_type: "all" | "role" | "users" | "players_in_season";
  audience_role: string | null;
  audience_user_ids: string[] | null;
} {
  const audience_type = String(formData.get("audience_type") ?? "all") as
    | "all"
    | "role"
    | "users"
    | "players_in_season";
  const audience_role =
    audience_type === "role" ? String(formData.get("audience_role") ?? "player") : null;
  const rawUsers = String(formData.get("audience_user_ids") ?? "").trim();
  const audience_user_ids =
    audience_type === "users"
      ? rawUsers
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : null;
  return { audience_type, audience_role, audience_user_ids };
}

async function currentPublicUserId(
  sb: Awaited<ReturnType<typeof getServerSupabase>>
): Promise<string | null> {
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", data.user.id)
    .single();
  return pub?.id ?? null;
}

export async function submitAnnouncement(formData: FormData) {
  const sb = await getServerSupabase();
  const publisherId = await currentPublicUserId(sb);
  if (!publisherId) throw new Error("not authenticated");

  const mode = String(formData.get("mode") ?? "draft"); // 'publish_now' | 'schedule' | 'draft'
  const title = String(formData.get("title") ?? "").trim();
  const body_md = String(formData.get("body_md") ?? "");
  const priority = String(formData.get("priority") ?? "info") as
    | "info"
    | "important"
    | "urgent";
  const is_public = formData.get("is_public") === "on";
  const channels = parseChannels(formData);
  const audience = parseAudience(formData);
  const scheduled_raw = String(formData.get("scheduled_publish_at") ?? "").trim();
  const scheduled_publish_at = scheduled_raw ? new Date(scheduled_raw).toISOString() : null;

  if (!title) throw new Error("title required");
  if (channels.length === 0) throw new Error("at least one channel required");

  const { id } = await create(sb, {
    title,
    body_md,
    priority,
    is_public,
    channels,
    scheduled_publish_at: mode === "schedule" ? scheduled_publish_at : null,
    ...audience,
  });

  if (mode === "publish_now") {
    await publishNow(sb, id, publisherId);
  } else if (mode === "schedule") {
    if (!scheduled_publish_at) throw new Error("scheduled_publish_at required for schedule mode");
    await schedulePublish(sb, id, scheduled_publish_at);
  }

  redirect(`/admin/announcements/${id}`);
}
