import { redirect } from "next/navigation";

/**
 * UI Audit Slice 4 (2026-04-28) — bare /admin/system redirects to the
 * Trash sub-tab (the only System sub-page today).
 */

export const dynamic = "force-dynamic";

export default async function SystemIndex() {
  redirect("/admin/system/trash");
}
