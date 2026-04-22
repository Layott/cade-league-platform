import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentSquadStatus } from "@/server/profile/squadStatus";
import { SquadDueBanner } from "@/components/profile/SquadDueBanner";
import { PlayerSubnav } from "./PlayerSubnav";

/**
 * Plan 10 — /player/* layout. Authentication is enforced at the middleware
 * level; this server component re-verifies so accidentally-routed public
 * users aren't shown a broken shell.
 *
 * Plan 13B — mounts the PlayerSubnav below the eyebrow tag.
 * Plan 41 (P41-F) — mounts <SquadDueBanner /> just under the chrome so it
 *   persists across every /player/** route until submitted OR window closed.
 */
export default async function PlayerLayout({ children }: { children: ReactNode }) {
  const sb = await getServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login?next=/player/squad");

  // Resolve the viewer's linked player (if any) to drive the banner.
  const { data: pub } = await sb
    .from("users")
    .select("id")
    .eq("supabase_auth_id", user.id)
    .maybeSingle();
  const { data: player } = pub
    ? await sb
        .from("players")
        .select("id")
        .eq("user_id", pub.id)
        .is("deleted_at", null)
        .maybeSingle()
    : { data: null as { id: string } | null };
  const status = player
    ? await getCurrentSquadStatus(sb, player.id, new Date())
    : null;

  return (
    <>
      {status ? <SquadDueBanner status={status} /> : null}
      <div className="mx-auto max-w-5xl px-5 py-8">
        <div className="mb-4 text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--signal)]">
          Player console
        </div>
        <PlayerSubnav />
        {children}
      </div>
    </>
  );
}
