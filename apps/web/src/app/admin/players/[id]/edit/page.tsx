import { redirect } from "next/navigation";

/**
 * UI Audit Slice 4 (2026-04-28) — legacy /admin/players/[id]/edit
 * redirects to the new Roster-hub canonical URL.
 */

export const dynamic = "force-dynamic";

export default async function PlayerEditRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/admin/people/players/${id}/edit`);
}
