import { redirect } from "next/navigation";

/**
 * UI Audit Slice 2 (2026-04-28) — `/player/disputes` collapsed into
 * the merged `/player/cases?tab=disputes` page. Anything still
 * pointing here (stale bookmarks, server-action `revalidatePath`
 * hits, notification deep links) gets bounced forward.
 *
 * The new-form route `/player/disputes/new` is intentionally NOT
 * redirected — Slice 2 merges LIST views, not submit flows. Submitter
 * server actions now redirect to `/player/cases?tab=disputes` after
 * a successful insert.
 *
 * Same redirect pattern as Plan 52's `/admin/broadcast/[sessionId]`
 * → `/admin/broadcast/v2/[sessionId]` shim.
 */

export const dynamic = "force-dynamic";

export default async function PlayerDisputesRedirect() {
  redirect("/player/cases?tab=disputes");
}
