import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email/resend";
import { getServiceRoleSupabase } from "@/lib/supabase/service";

/**
 * 2026-04-24 — End-to-end notification system.
 *
 * Single entry point `notify()` inserts a `notifications` row and, when
 * the caller opts in (default = on), fires an email via the existing
 * `sendEmail` helper. In-app + email are decoupled: if Resend fails, the
 * in-app row still lives + the UI bell still bumps. `email_sent_at` is a
 * truthful delivery stamp for the email channel.
 *
 * The server module is the ONLY path that should write to the
 * notifications table. Callers elsewhere in the codebase must import
 * `notify()` rather than `sb.from('notifications').insert(...)` — this
 * guarantees consistent deep-links + email fan-out.
 */

export const NOTIFICATION_KINDS = [
  "announcement",
  "squad_reopened",
  "dispute_ruled",
  "appeal_ruled",
  "squad_approved",
  "squad_rejected",
  "punishment_issued",
  "punishment_revoked",
  "match_voided",
  "match_unvoided",
  "friday_window_open",
  "friday_window_closed",
  "generic",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type NotifyInput = {
  userId: string;
  kind: Exclude<NotificationKind, "announcement">; // announcements flow through the dedicated module
  title: string;
  body?: string;
  href?: string;
  metadata?: Record<string, unknown>;
  sendEmail?: boolean; // default true — opt-out for silent rows
};

export type Notification = {
  id: string;
  user_id: string;
  type: NotificationKind;
  title: string | null;
  body: string | null;
  href: string | null;
  metadata: Record<string, unknown>;
  delivered_channels: string[];
  email_sent_at: string | null;
  read_at: string | null;
  created_at: string;
};

/**
 * Insert one notification + optionally email the user.
 *
 * The `sb` client passed by callers is usually the service-role client
 * (so the insert survives RLS) — but even a user-scoped client will work
 * because the migration only adds a SELECT policy; INSERT is not
 * restricted. For the email fan-out we always use a service-role client
 * internally so we can read `users.email` regardless of the caller's
 * auth context.
 */
export async function notify(
  sb: SupabaseClient,
  input: NotifyInput,
): Promise<void> {
  const deliveredChannels = ["in_app"];
  const { data: inserted, error } = await sb
    .from("notifications")
    .insert({
      user_id: input.userId,
      type: input.kind,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      metadata: input.metadata ?? {},
      delivered_channels: deliveredChannels,
      announcement_id: null,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    throw new Error(`notify insert failed: ${error?.message ?? "unknown"}`);
  }

  // Email fan-out unless explicitly disabled. We don't throw on email
  // errors — the in-app row is the source of truth; email is a best-effort
  // notification channel and transient Resend failures shouldn't block the
  // admin's write flow.
  if (input.sendEmail === false) return;

  try {
    const svc = resolveServiceClient();
    const { data: user } = await svc
      .from("users")
      .select("email, display_name")
      .eq("id", input.userId)
      .is("deleted_at", null)
      .maybeSingle();
    const email = (user as { email?: string | null; display_name?: string | null } | null)?.email ?? null;
    if (!email) {
      // No email on file — log + leave email_sent_at null. In-app is still good.
      console.log(
        `[notifications] user ${input.userId} has no email; skipping email send for ${input.kind}`,
      );
      return;
    }

    const displayName = (user as { display_name?: string | null } | null)?.display_name ?? null;
    const html = renderNotificationHtml({
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      displayName,
    });
    const text = renderNotificationText({
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      displayName,
    });

    const ok = await sendEmail({
      to: email,
      subject: input.title,
      html,
      text,
    });

    if (ok) {
      // Stamp email_sent_at so admins can see email delivery state from
      // the row itself. Also append 'email' to delivered_channels for
      // symmetry with the announcements fan-out.
      await svc
        .from("notifications")
        .update({
          email_sent_at: new Date().toISOString(),
          delivered_channels: [...deliveredChannels, "email"],
        })
        .eq("id", inserted.id);
    } else {
      console.log(
        `[notifications] email send returned false for ${input.kind} to ${email}`,
      );
    }
  } catch (err) {
    // Never let email failures bubble up. Log and continue.
    console.error(`[notifications] email fan-out failed: ${String(err)}`);
  }
}

/**
 * Mark a set of notification ids as read. Scoped to the actor's user_id
 * server-side so a client can't mark other users' rows as read.
 *
 * Returns the number of rows flipped. When a user-scoped client hits a
 * missing UPDATE RLS policy Postgres silently reports zero affected
 * rows — callers can assert the count to detect that condition.
 */
export async function markRead(
  sb: SupabaseClient,
  actorUserId: string,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await sb
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids)
    .eq("user_id", actorUserId)
    .is("read_at", null)
    .select("id");
  if (error) throw new Error(`markRead failed: ${error.message}`);
  return (data ?? []).length;
}

/**
 * Mark every unread notification owned by this user as read. Idempotent:
 * a second call matches zero rows.
 *
 * Returns the number of rows flipped so the API layer can sanity-check
 * the mutation actually landed (guards against RLS silent-no-op).
 */
export async function markAllRead(
  sb: SupabaseClient,
  actorUserId: string,
): Promise<number> {
  const { data, error } = await sb
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", actorUserId)
    .is("deleted_at", null)
    .is("read_at", null)
    .select("id");
  if (error) throw new Error(`markAllRead failed: ${error.message}`);
  return (data ?? []).length;
}

/**
 * Fetch up to `limit` most-recent notifications for a user. The shape
 * matches the bell-dropdown + /notifications listing contract.
 *
 * Announcement-backed rows (type='announcement') project their title via
 * the `announcements` join so the single reader can serve every kind.
 */
export async function listForUser(
  sb: SupabaseClient,
  userId: string,
  opts: { unreadOnly?: boolean; limit?: number } = {},
): Promise<Notification[]> {
  const limit = opts.limit ?? 50;
  let q = sb
    .from("notifications")
    .select(
      "id, user_id, type, title, body, href, metadata, delivered_channels, email_sent_at, read_at, created_at, announcement:announcements(title, body_md)",
    )
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (opts.unreadOnly) q = q.is("read_at", null);

  const { data, error } = await q;
  if (error) throw new Error(`listForUser failed: ${error.message}`);

  type Row = Notification & {
    announcement: { title: string | null; body_md: string | null } | null;
  };

  return ((data ?? []) as unknown as Row[]).map((row) => {
    const resolvedTitle =
      row.type === "announcement"
        ? row.title ?? row.announcement?.title ?? null
        : row.title;
    const resolvedBody =
      row.type === "announcement"
        ? row.body ?? row.announcement?.body_md ?? null
        : row.body;
    return {
      id: row.id,
      user_id: row.user_id,
      type: row.type,
      title: resolvedTitle,
      body: resolvedBody,
      href: row.href,
      metadata: row.metadata ?? {},
      delivered_channels: row.delivered_channels ?? [],
      email_sent_at: row.email_sent_at,
      read_at: row.read_at,
      created_at: row.created_at,
    };
  });
}

/**
 * Cheap count for the bell badge. Uses the partial index from the
 * original migration (user_id, created_at DESC) WHERE deleted_at IS NULL
 * AND read_at IS NULL.
 */
export async function unreadCount(
  sb: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count, error } = await sb
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("deleted_at", null)
    .is("read_at", null);
  if (error) throw new Error(`unreadCount failed: ${error.message}`);
  return count ?? 0;
}

// ---------- helpers ----------

/**
 * Resolve the service-role client for email fan-out. The caller-provided
 * `sb` may already be a service-role client — we still call
 * `getServiceRoleSupabase()` which caches + returns the same singleton,
 * so there's no double-client overhead.
 */
function resolveServiceClient(): SupabaseClient {
  return getServiceRoleSupabase();
}

type EmailRender = {
  title: string;
  body: string | null;
  href: string | null;
  displayName: string | null;
};

function resolvePublicUrl(href: string): string {
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    "https://cadeesports.com";
  const trimmed = base.replace(/\/$/, "");
  return `${trimmed}${href.startsWith("/") ? "" : "/"}${href}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderNotificationHtml(r: EmailRender): string {
  const safeTitle = escapeHtml(r.title);
  const safeBody = r.body ? escapeHtml(r.body).replace(/\n/g, "<br />") : "";
  const greeting = r.displayName
    ? `<p style="margin:0 0 12px;color:#444;font-size:14px">Hi ${escapeHtml(r.displayName)},</p>`
    : "";
  const button = r.href
    ? `<p style="margin:20px 0"><a href="${escapeHtml(resolvePublicUrl(r.href))}" style="display:inline-block;padding:10px 18px;background:#6bcd06;color:#000;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;border-radius:3px" onmouseover="this.style.background='#fe036d';this.style.color='#fff'">View details</a></p>`
    : "";
  const bodyBlock = safeBody
    ? `<p style="margin:0 0 12px;color:#222;font-size:14px;line-height:1.5">${safeBody}</p>`
    : "";
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f5f5f5">
      <tr>
        <td align="center" style="padding:24px 12px">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#fff;border-radius:4px;border-top:4px solid #6bcd06">
            <tr>
              <td style="padding:24px 24px 8px">
                <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#6bcd06;font-weight:700;margin-bottom:8px">CADE Esports League</div>
                <h1 style="margin:0 0 16px;font-size:20px;color:#111;line-height:1.3">${safeTitle}</h1>
                ${greeting}
                ${bodyBlock}
                ${button}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px 24px;border-top:1px solid #eee">
                <p style="margin:0;font-size:11px;color:#888;line-height:1.5">
                  You are receiving this because you have an active CADE League account.
                  <br />
                  <a href="${escapeHtml(resolvePublicUrl("/profile"))}" style="color:#888;text-decoration:underline">Manage notifications</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderNotificationText(r: EmailRender): string {
  const parts: string[] = [];
  parts.push(r.title);
  if (r.displayName) parts.push("", `Hi ${r.displayName},`);
  if (r.body) parts.push("", r.body);
  if (r.href) parts.push("", `View: ${resolvePublicUrl(r.href)}`);
  parts.push("", "— CADE Esports League", "Manage notifications: " + resolvePublicUrl("/profile"));
  return parts.join("\n");
}
