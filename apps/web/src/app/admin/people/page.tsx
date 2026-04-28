import { redirect } from "next/navigation";

/**
 * UI Audit Slice 4 (2026-04-28) — bare /admin/people redirects to the
 * Players sub-tab (the most-used Roster surface).
 */

export const dynamic = "force-dynamic";

export default async function PeopleIndex() {
  redirect("/admin/people/players");
}
