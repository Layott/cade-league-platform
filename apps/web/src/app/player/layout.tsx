import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { PlayerSubnav } from "./PlayerSubnav";

/**
 * Plan 10 — /player/* layout. Authentication is enforced at the middleware
 * level; this server component re-verifies so accidentally-routed public
 * users aren't shown a broken shell.
 *
 * Plan 13B — mounts the PlayerSubnav below the eyebrow tag.
 */
export default async function PlayerLayout({ children }: { children: ReactNode }) {
  const sb = await getServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login?next=/player/squad");

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <div className="mb-4 text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--signal)]">
        Player console
      </div>
      <PlayerSubnav />
      {children}
    </div>
  );
}
