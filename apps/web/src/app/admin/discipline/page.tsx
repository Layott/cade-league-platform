import { redirect } from "next/navigation";

/**
 * UI Audit Slice 4 (2026-04-28) — bare /admin/discipline redirects to
 * the Punishments sub-tab (the most common entry point for moderators).
 */

export const dynamic = "force-dynamic";

export default async function DisciplineIndex() {
  redirect("/admin/discipline/punishments");
}
