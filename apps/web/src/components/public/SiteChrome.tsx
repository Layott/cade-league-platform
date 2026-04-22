import { ReactNode } from "react";
import { getServerSupabase } from "@/lib/supabase/server";
import { SiteChromeClient } from "./SiteChromeClient";
import { UserBadge } from "./UserBadge";
import { AnnouncementBell } from "./AnnouncementBell";

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
        .select("id")
        .eq("supabase_auth_id", user.id)
        .maybeSingle();

      if (pub) {
        const { data: rolesRows } = await sb
          .from("user_roles")
          .select("role")
          .eq("user_id", pub.id)
          .is("deleted_at", null);
        const roles = (rolesRows ?? []).map((r: { role: string }) => r.role);
        isStaff = roles.some(
          (r) =>
            r === "admin" ||
            r === "moderator" ||
            r === "loc" ||
            r === "idc" ||
            r === "referee" ||
            r === "production",
        );
      }
    }
  } catch {
    // Session read failed — render the unauthenticated chrome rather than
    // crashing the entire site. The /admin middleware still gates writes.
  }

  // UserBadge (server component) + AnnouncementBell (client) rendered in
  // the server parent so the client shell can slot them without having to
  // compute auth itself. UserBadge falls back to a Sign-in link when the
  // session read fails, so this stays safe under auth errors.
  return (
    <SiteChromeClient
      authenticated={authenticated}
      isStaff={isStaff}
      userBadge={<UserBadge />}
      announcementBell={authenticated ? <AnnouncementBell /> : null}
    >
      {children}
    </SiteChromeClient>
  );
}
