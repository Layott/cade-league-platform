"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { create, publishNow, schedulePublish } from "@/server/announcements";

const announcementSubmitSchema = z.object({
  mode: z.enum(["draft", "publish_now", "schedule"]).default("draft"),
  title: z.string().trim().min(1).max(200),
  body_md: z.string().trim().min(1).max(20_000),
  priority: z.enum(["info", "important", "urgent"]).default("info"),
  is_public: z.boolean().default(false),
  channels: z.array(z.enum(["in_app", "email"])).min(1).max(2),
  audience_type: z
    .enum(["all", "role", "users", "players_in_season"])
    .default("all"),
  audience_role: z.string().trim().max(50).nullable(),
  audience_user_ids: z.array(z.string().uuid()).max(1000).nullable(),
  scheduled_publish_at: z.string().datetime().nullable(),
});

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

  const audience = parseAudience(formData);
  const scheduled_raw = String(formData.get("scheduled_publish_at") ?? "").trim();
  const scheduled_publish_at = scheduled_raw ? new Date(scheduled_raw).toISOString() : null;

  const parsed = announcementSubmitSchema.parse({
    mode: String(formData.get("mode") ?? "draft"),
    title: String(formData.get("title") ?? ""),
    body_md: String(formData.get("body_md") ?? ""),
    priority: String(formData.get("priority") ?? "info"),
    is_public: formData.get("is_public") === "on",
    channels: parseChannels(formData),
    audience_type: audience.audience_type,
    audience_role: audience.audience_role,
    audience_user_ids: audience.audience_user_ids,
    scheduled_publish_at,
  });

  const { id } = await create(sb, {
    title: parsed.title,
    body_md: parsed.body_md,
    priority: parsed.priority,
    is_public: parsed.is_public,
    channels: parsed.channels,
    scheduled_publish_at:
      parsed.mode === "schedule" ? parsed.scheduled_publish_at : null,
    audience_type: parsed.audience_type,
    audience_role: parsed.audience_role,
    audience_user_ids: parsed.audience_user_ids,
  });

  if (parsed.mode === "publish_now") {
    await publishNow(sb, id, publisherId);
  } else if (parsed.mode === "schedule") {
    if (!parsed.scheduled_publish_at) {
      throw new Error("scheduled_publish_at required for schedule mode");
    }
    await schedulePublish(sb, id, parsed.scheduled_publish_at);
  }

  redirect(`/admin/announcements/${id}`);
}
