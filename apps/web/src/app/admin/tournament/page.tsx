import { redirect } from "next/navigation";

/**
 * Plan 51 — landing page for /admin/tournament forwards to the
 * standings tab. Sibling agents (UI-T) own the per-tab pages, so this
 * file just bounces to the canonical default.
 */
export default function TournamentLanding() {
  redirect("/admin/tournament/standings");
}
