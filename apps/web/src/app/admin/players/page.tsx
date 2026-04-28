import { redirect } from "next/navigation";

/**
 * UI Audit Slice 4 (2026-04-28) — `/admin/players` is now the legacy
 * path. The canonical surface is `/admin/people/players` under the
 * Roster hub. Stale bookmarks / external links still resolve.
 */

export const dynamic = "force-dynamic";

export default async function PlayersRedirect() {
  redirect("/admin/people/players");
}
