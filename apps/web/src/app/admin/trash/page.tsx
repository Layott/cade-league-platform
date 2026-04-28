import { redirect } from "next/navigation";

/** UI Audit Slice 4 (2026-04-28) — moved under System hub. */

export const dynamic = "force-dynamic";

export default async function TrashRedirect() {
  redirect("/admin/system/trash");
}
