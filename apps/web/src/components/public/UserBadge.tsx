import Link from "next/link";
import { getServerSupabase } from "@/lib/supabase/server";
import { getActorFromSession } from "@/server/auth/actor";
import { UserBadgeShell } from "./UserBadgeShell";

/**
 * Plan 40 P40-A — UserBadge (server component)
 *
 * Replaces the ad-hoc displayName + logout form in `SiteChromeClient`
 * with a proper identity surface. Runs server-side so the badge paints
 * on first frame with no auth flicker.
 *
 * Flow:
 *  1. Read the Supabase auth user + map to the public `users.id`.
 *  2. If there's no logged-in user (or any error occurs) render the
 *     existing "Sign in" CTA so the header never crashes. Per Plan 40
 *     spec §9 rollout note: SiteChrome mounts on every non-overlay
 *     route, so any uncaught error here would take the whole app down.
 *  3. Otherwise: one select joining `users + user_roles + players` for
 *     photo + display_name + all active roles, then hand off to
 *     `<UserBadgeShell />` (client island using native `<details>`).
 *
 * Mount wiring into `SiteChrome` is deferred to the main thread — this
 * file ships the component only. See P40 spec §3.1.
 */

export async function UserBadge() {
  try {
    const sb = await getServerSupabase();

    // Auth probe — one call, no sidecar wrappers. A signed-in user always
    // has `data.user`; anything else is anon (or a token that Supabase
    // rejects).
    const { data: authData } = await sb.auth.getUser();
    if (!authData.user) return <SignInLink />;

    // Public users row — PII read. Plan 39 C2 column-level grants let
    // authenticated read (id, display_name, created_at, updated_at,
    // deleted_at); email requires service-role. We therefore read only
    // columns anon+authenticated hold, plus pull the fallback display
    // name from the auth user's email metadata if the public row has
    // no display_name (non-player role seed rows can lack one).
    const { data: pub } = await sb
      .from("users")
      .select("id, display_name")
      .eq("supabase_auth_id", authData.user.id)
      .is("deleted_at", null)
      .maybeSingle();

    // If the users row is missing (shouldn't happen post-Plan 2 mirror
    // trigger, but be resilient) render a minimal signed-in badge rather
    // than a fake Sign-in link. Email → initials fallback.
    const authEmail = authData.user.email ?? null;
    if (!pub) {
      return (
        <UserBadgeShell
          displayName={authEmail ? authEmail.split("@")[0]! : "You"}
          photoUrl={null}
          roles={[]}
        />
      );
    }

    // One select joining user_roles + players(photo_url). Keep the
    // explicit FK name for `players.user_id` consistent with the post
    // Plan 13A disambiguation lesson in CLAUDE.md.
    const [{ data: roleRows }, { data: playerRow }] = await Promise.all([
      sb
        .from("user_roles")
        .select("role")
        .eq("user_id", pub.id)
        .is("deleted_at", null),
      sb
        .from("players")
        .select("photo_url")
        .eq("user_id", pub.id)
        .is("deleted_at", null)
        .maybeSingle(),
    ]);

    const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
    const displayName =
      (pub.display_name && pub.display_name.trim()) ||
      (authEmail ? authEmail.split("@")[0]! : "You");
    const photoUrl = playerRow?.photo_url ?? null;

    return (
      <UserBadgeShell
        displayName={displayName}
        photoUrl={photoUrl}
        roles={roles}
      />
    );
  } catch (err) {
    // Surface the error in dev-server logs so a signed-in user seeing
    // the Sign-in fallback gets diagnosed fast. Plan 40 spec §9: never
    // crash the header, but do NOT swallow the reason silently.
    // eslint-disable-next-line no-console
    console.error("[UserBadge] falling back to SignInLink:", err);
    return <SignInLink />;
  }
}

/**
 * Unauthenticated fallback. Matches the existing "Staff" CTA idiom in
 * `SiteChromeClient` so replacing the old displayName block keeps the
 * nav visually coherent.
 */
function SignInLink() {
  return (
    <Link
      href="/login"
      className="inline-flex items-center gap-2 rounded-sm border border-[var(--ink-4)] bg-[var(--ink-2)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-[var(--chalk-1)] transition-colors hover:border-[var(--signal)] hover:text-[var(--signal)]"
      data-testid="user-badge-sign-in"
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full bg-[var(--signal)] pulse-dot"
      />
      Sign in
    </Link>
  );
}
