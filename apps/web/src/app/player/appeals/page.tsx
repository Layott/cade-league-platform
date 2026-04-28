import { redirect } from "next/navigation";

/**
 * UI Audit Slice 2 (2026-04-28) — `/player/appeals` collapsed into
 * the merged `/player/cases?tab=appeals` page. Anything still
 * pointing here (stale bookmarks, `revalidatePath` calls,
 * notification deep links, the email-link templates in
 * `/server/notifications/index.ts`) gets bounced forward.
 *
 * The new-form route `/player/appeals/new?caseId=…` is intentionally
 * NOT redirected — Slice 2 merges LIST views, not submit flows.
 * Submitter server actions now redirect to
 * `/player/cases?tab=appeals` after insert.
 *
 * Same redirect pattern as Plan 52's `/admin/broadcast/[sessionId]`
 * → `/admin/broadcast/v2/[sessionId]` shim.
 */

export const dynamic = "force-dynamic";

export default async function PlayerAppealsRedirect() {
  redirect("/player/cases?tab=appeals");
}
