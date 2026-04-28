import { redirect } from "next/navigation";

/** UI Audit Slice 4 (2026-04-28) — moved under Match days hub. */

export const dynamic = "force-dynamic";

export default async function StatsReviewRedirect() {
  redirect("/admin/match-days/stats-review");
}
