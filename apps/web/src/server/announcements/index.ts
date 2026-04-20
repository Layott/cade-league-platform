import type { SupabaseClient } from "@supabase/supabase-js";
import { expandAudience, type AnnouncementAudience } from "./audience";
import { renderMarkdownToSafeHtml } from "./render";
import { sendEmail } from "@/lib/email/resend";

export type CreateInput = {
  title: string;
  body_md: string;
  priority?: "info" | "important" | "urgent";
  audience_type: AnnouncementAudience["audience_type"];
  audience_role?: string | null;
  audience_user_ids?: string[] | null;
  channels?: string[];
  is_public?: boolean;
  scheduled_publish_at?: string | null;
};

export async function create(sb: SupabaseClient, input: CreateInput): Promise<{ id: string }> {
  const { data, error } = await sb
    .from("announcements")
    .insert({
      title: input.title,
      body_md: input.body_md,
      priority: input.priority ?? "info",
      audience_type: input.audience_type,
      audience_role: input.audience_role ?? null,
      audience_user_ids: input.audience_user_ids ?? null,
      channels: input.channels ?? ["in_app", "email"],
      is_public: input.is_public ?? false,
      scheduled_publish_at: input.scheduled_publish_at ?? null,
      published_at: null,
      published_by: null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`announcements.create failed: ${error?.message}`);
  return { id: data.id };
}

export async function schedulePublish(
  sb: SupabaseClient,
  announcementId: string,
  publishAt: string
): Promise<void> {
  const { error } = await sb
    .from("announcements")
    .update({ scheduled_publish_at: publishAt })
    .eq("id", announcementId)
    .is("deleted_at", null);
  if (error) throw new Error(`announcements.schedulePublish failed: ${error.message}`);
}

export async function publishNow(
  sb: SupabaseClient,
  announcementId: string,
  publisherUserId: string
): Promise<{ delivered: number }> {
  // Fetch announcement.
  const { data: ann, error: fetchErr } = await sb
    .from("announcements")
    .select(
      "id, title, body_md, channels, audience_type, audience_role, audience_user_ids, published_at"
    )
    .eq("id", announcementId)
    .is("deleted_at", null)
    .single();
  if (fetchErr || !ann) throw new Error(`announcement not found: ${announcementId}`);
  if (ann.published_at) return { delivered: 0 }; // idempotent

  // Expand audience.
  const userIds = await expandAudience(sb, ann as AnnouncementAudience);
  const channels: string[] = ann.channels ?? ["in_app", "email"];
  const wantsInApp = channels.includes("in_app");
  const wantsEmail = channels.includes("email");

  // Mark published FIRST so a concurrent cron run can't double-deliver.
  const { error: markErr } = await sb
    .from("announcements")
    .update({
      published_at: new Date().toISOString(),
      published_by: publisherUserId,
    })
    .eq("id", announcementId)
    .is("published_at", null);
  if (markErr) throw new Error(`publish mark failed: ${markErr.message}`);

  if (userIds.length === 0) return { delivered: 0 };

  // Bulk insert notifications if in_app channel selected. Even if only email
  // is chosen, we still create a notifications row so read-state + count of
  // recipients is trackable — delivered_channels reflects reality.
  const delivered: string[] = [];
  if (wantsInApp) delivered.push("in_app");
  // Email is appended per-user only on success below.
  const notifRows = userIds.map((user_id) => ({
    announcement_id: announcementId,
    user_id,
    delivered_channels: delivered.slice(),
  }));

  const { error: insErr } = await sb
    .from("notifications")
    .upsert(notifRows, { onConflict: "announcement_id,user_id", ignoreDuplicates: true });
  if (insErr) throw new Error(`notifications insert failed: ${insErr.message}`);

  // Email fan-out — one by one (small audiences; batch later if it gets slow).
  if (wantsEmail) {
    const { data: recipients } = await sb
      .from("users")
      .select("id, email, display_name")
      .in("id", userIds)
      .is("deleted_at", null);

    const html = wrapEmailHtml(ann.title, renderMarkdownToSafeHtml(ann.body_md));
    const text = `${ann.title}\n\n${stripTags(renderMarkdownToSafeHtml(ann.body_md))}\n\n— Sent by CADE League`;

    for (const r of (recipients ?? []) as { id: string; email: string }[]) {
      const ok = await sendEmail({
        to: r.email,
        subject: ann.title,
        html,
        text,
      });
      if (ok) {
        // Append 'email' to delivered_channels for this user.
        await sb
          .from("notifications")
          .update({ delivered_channels: [...delivered, "email"] })
          .eq("announcement_id", announcementId)
          .eq("user_id", r.id);
      }
    }
  }

  return { delivered: userIds.length };
}

export async function listForUser(
  sb: SupabaseClient,
  userId: string,
  opts: { limit?: number } = {}
): Promise<
  Array<{
    id: string;
    announcement_id: string;
    read_at: string | null;
    title: string;
    priority: string;
    published_at: string | null;
  }>
> {
  const limit = opts.limit ?? 50;
  const { data, error } = await sb
    .from("notifications")
    .select(
      "id, announcement_id, read_at, announcement:announcements(title, priority, published_at)"
    )
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listForUser failed: ${error.message}`);
  return ((data ?? []) as unknown as Array<{
    id: string;
    announcement_id: string;
    read_at: string | null;
    announcement: { title: string; priority: string; published_at: string | null } | null;
  }>).map((n) => ({
    id: n.id,
    announcement_id: n.announcement_id,
    read_at: n.read_at,
    title: n.announcement?.title ?? "",
    priority: n.announcement?.priority ?? "info",
    published_at: n.announcement?.published_at ?? null,
  }));
}

export async function markRead(
  sb: SupabaseClient,
  notificationId: string,
  userId: string
): Promise<void> {
  // Only update if unread and owned by this user — idempotent + authorized.
  const { error } = await sb
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) throw new Error(`markRead failed: ${error.message}`);
}

// --- local helpers ---

function wrapEmailHtml(title: string, innerHtml: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111">
    <h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>
    <div>${innerHtml}</div>
    <hr style="border:none;border-top:1px solid #ddd;margin:24px 0" />
    <p style="font-size:12px;color:#666">Sent by CADE League</p>
  </body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}
