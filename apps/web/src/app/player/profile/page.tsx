import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Player-subnav "Profile" link historically landed on a Plan-13B stub
 * page with email + display_name only. The rich profile (season stats,
 * recent form, streaks, match history, H2H, sanctions + appeal status,
 * squad status, my disputes, attendance) lives at `/profile` under the
 * (auth) group. Redirect here so the subnav + any stale deep-link both
 * resolve to the complete view.
 */
export default function PlayerProfileRedirectPage() {
  redirect("/profile");
}
