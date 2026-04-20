import { ReactNode } from "react";
import { getServerSupabase } from "@/lib/supabase/server";
import { getUnreadCountForAuthUser } from "@/lib/notifications/unreadCount";
import { SiteChromeClient } from "./SiteChromeClient";

/**
 * SiteChrome is a Server Component wrapper that reads the current session
 * server-side (so the role-gated Admin link + unread bell count can render
 * on first paint) and passes a minimal prop bag to the client inner shell.
 *
 * It renders on every route except /login + /logout (those are deliberately
 * minimal). The /admin/* routes get the same global header so admins always
 * have a single nav surface with "Back to site" semantics baked in.
 */

export async function SiteChrome({ children }: { children: ReactNode }) {
  let isStaff = false;
  let displayName: string | null = null;
  let unread = 0;
  let authenticated = false;

  try {
    const sb = await getServerSupabase();
    const {
      data: { user },
    } = await sb.auth.getUser();

    if (user) {
      authenticated = true;
      const { data: pub } = await sb
        .from("users")
        .select("id, display_name")
        .eq("supabase_auth_id", user.id)
        .maybeSingle();

      if (pub) {
        displayName = pub.display_name ?? null;
        const { data: rolesRows } = await sb
          .from("user_roles")
          .select("role")
          .eq("user_id", pub.id)
          .is("deleted_at", null);
        const roles = (rolesRows ?? []).map((r: { role: string }) => r.role);
        isStaff = roles.some((r) => r === "admin" || r === "moderator");
      }

      // Unread count for the bell (any authenticated user with a public users row).
      try {
        unread = await getUnreadCountForAuthUser(sb);
      } catch {
        unread = 0;
      }
    }
  } catch {
    // Session read failed — render the unauthenticated chrome rather than
    // crashing the entire site. The /admin middleware still gates writes.
  }

  return (
    <SiteChromeClient
      authenticated={authenticated}
      isStaff={isStaff}
      displayName={displayName}
      unread={unread}
    >
      {children}
    </SiteChromeClient>
  );
}
