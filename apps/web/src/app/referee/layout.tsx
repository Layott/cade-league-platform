import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Plan 46 — /referee/* layout. Thin chrome above the children pages. The
 * middleware already enforces role-based entry (referee | admin | moderator);
 * this server component only re-verifies the session so accidentally-routed
 * unauthenticated users see a login redirect rather than a broken shell.
 */
export default async function RefereeLayout({ children }: { children: ReactNode }) {
  const sb = await getServerSupabase();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login?next=/referee/attendance");

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <div className="mb-4 text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--signal)]">
        Referee console
      </div>
      {children}
    </div>
  );
}
